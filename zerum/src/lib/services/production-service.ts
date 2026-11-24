/**
 * Produção: lotes → vídeos → cenas. Persistido em SQLite; o log de cada lote é gravado em `events` (tempo real: a UI lê
 * a cada ~1,5 s).
 *
 * QUEM GERA: o executor real (Flow, pela extensão) é a fase futura. Aqui existe o executor SIMULADO (⚙ → "Simulação
 * local"): o relógio faz cada cena "ficar pronta" depois de `sceneMs`, e o vídeo "pronto" entregue para download é uma
 * CÓPIA do viral (ou um clipe de teste, se o lote não tem viral). Isso é sempre dito no log e no cartão do vídeo.
 * Com a simulação desligada, o lote fica em "na fila" esperando o executor — nada avança sozinho.
 *
 * O avanço é por LEITURA (`tick`): sem timers nem processos em segundo plano. Cada GET de produção/vídeos chama `tick`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { VIRALS_DIR } from '../config';
import path from 'node:path';
import { transaction } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { splitSpeech, readAnalysis } from '../domain/analysis';
import { pathLabel, variationLabel, type PlanParams } from '../domain/plan';
import {
  advanceVideos,
  applyChanges,
  batchStateOf,
  downloadName,
  sceneCount,
  sceneStateOf,
  type VideoRun,
} from '../domain/production';
import { languageName, optionsSummary } from '../domain/video-options';
import { deleteEvents, listEvents, logEvent } from '../repo/events';
import {
  deleteBatch,
  getBatchRow,
  insertBatch,
  listActiveBatchRows,
  listBatchRows,
  listBatchRowsByConversation,
  setArchived,
  setBatchState,
  setStopRequested,
  type BatchRow,
} from '../repo/batches';
import { countVideos, deleteVideo, getVideoRow, insertVideo, listReadyVideoRows, listVideoRows, patchVideo, type VideoRow } from '../repo/videos';
import { getViral } from '../repo/virals';
import type { BatchDTO, EventDTO, VideoDTO } from '../types';
import { bumpRoleta, getSimConfig, isSimulation } from './settings-service';
import { PLACEHOLDER_MP4 } from './placeholder-clip';
import type { ZipEntry } from '../domain/zip';
import { safeZipName, uniqueNames } from '../domain/zip';

export const viralFilePath = (hash: string): string => path.join(VIRALS_DIR, `${hash}.mp4`);

const batchHash = (id: string) => crypto.createHash('sha256').update(id).digest('hex');

const parseScenes = (raw: string): { fala: string }[] => {
  try {
    const p = JSON.parse(raw) as { fala?: unknown }[];
    return Array.isArray(p) ? p.map((s) => ({ fala: typeof s?.fala === 'string' ? s.fala : '' })) : [];
  } catch {
    return [];
  }
};

function toVideoDTO(v: VideoRow, batchName: string): VideoDTO {
  const run = { state: v.state, scenesDone: v.scenes_done, failScene: v.fail_scene };
  return {
    id: v.id,
    batchId: v.batch_id,
    idx: v.idx,
    title: v.title,
    scenes: parseScenes(v.scenes).map((s, i) => ({ fala: s.fala, state: sceneStateOf(run, i) })),
    avatarName: v.avatar_name,
    state: v.state,
    scenesTotal: v.scenes_total,
    scenesDone: v.scenes_done,
    failScene: v.fail_scene,
    error: v.error,
    attempt: v.attempt,
    downloadName: downloadName(batchName, batchHash(v.batch_id), v.idx),
    simulated: true,
    finishedAt: v.finished_at,
    createdAt: v.created_at,
  };
}

export function toBatchDTO(b: BatchRow, withVideos = true): BatchDTO {
  let avatars: string[] = [];
  try {
    avatars = JSON.parse(b.avatars) as string[];
  } catch {
    /* lista corrompida vira vazia */
  }
  return {
    id: b.id,
    conversationId: b.conversation_id,
    viralId: b.viral_id,
    viralName: b.viral_name,
    source: b.source,
    title: b.title,
    quantity: b.quantity,
    word: b.word,
    batchName: b.batch_name,
    bubbleOn: !!b.bubble_on,
    bubbleColor: b.bubble_color,
    language: b.language,
    requestText: b.request_text,
    state: b.state,
    path: b.path,
    variation: b.variation,
    avatars,
    notes: b.notes,
    stopRequested: !!b.stop_requested,
    archived: !!b.archived,
    videos: withVideos ? listVideoRows(b.id).map((v) => toVideoDTO(v, b.batch_name)) : [],
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

export interface OpenBatchInput {
  conversationId: string | null;
  viralId: string | null;
  source: 'diretor' | 'manual';
  title: string;
  params: Pick<PlanParams, 'quantity' | 'path' | 'variation' | 'language' | 'word' | 'batchName' | 'bubbleOn' | 'bubbleColor' | 'notes' | 'newAvatars'>;
  /** Quem aparece, em rodízio (um por vídeo). Vazio = "avatares salvos"/novos. */
  avatarNames: string[];
  requestText: string;
}

/** Roteiro de cada cena: do viral quando há transcrição; senão um texto honesto dizendo o que falta. */
function sceneScripts(input: OpenBatchInput, nScenes: number, transcricao: string): { fala: string }[] {
  const chunks = splitSpeech(transcricao, nScenes);
  return Array.from({ length: nScenes }, (_, i) => {
    const k = i + 1;
    if (input.params.path === 'adaptar') {
      return { fala: `Cena ${k}: fala nova sobre o mesmo assunto (o roteiro é escrito pela IA do Diretor — fase futura).` };
    }
    return { fala: chunks[i] || `Cena ${k}: mesma fala do viral (a transcrição está vazia — preencha em “A leitura errou? Corrigir”).` };
  });
}

/** Cria o lote e seus vídeos (todos "na fila") e registra o log inicial. Reutilizado pelo Diretor (ao confirmar) e pelo Manual. */
export function openBatch(input: OpenBatchInput): BatchDTO {
  return transaction(() => {
    const viral = input.viralId ? getViral(input.viralId) : undefined;
    const analysis = viral ? readAnalysis(viral.analysis) : null;
    const n = sceneCount(viral?.duration_s ?? null);
    const p = input.params;
    const batch = insertBatch({
      conversationId: input.conversationId,
      viralId: viral?.id ?? null,
      source: input.source,
      title: input.title,
      quantity: p.quantity,
      word: p.word,
      batchName: p.batchName,
      bubbleOn: p.bubbleOn,
      bubbleColor: p.bubbleColor,
      language: p.language,
      requestText: input.requestText,
      path: p.path,
      variation: p.variation,
      avatars: input.avatarNames,
      notes: p.notes,
    });
    for (let i = 0; i < p.quantity; i++) {
      const avatar = input.avatarNames.length ? input.avatarNames[i % input.avatarNames.length] : p.newAvatars > 0 ? `Avatar novo ${i + 1}` : '';
      insertVideo({
        batchId: batch.id,
        idx: i,
        title: `${input.title} · vídeo ${i + 1}`,
        scenes: sceneScripts(input, n, analysis?.transcricao ?? ''),
        avatarName: avatar,
      });
    }
    if (p.variation === 'roleta') bumpRoleta(p.quantity);

    const id = batch.id;
    logEvent('batch', id, `Lote criado (${input.source === 'diretor' ? 'pelo Diretor, plano confirmado' : 'manual'}): ${p.quantity} vídeo${p.quantity === 1 ? '' : 's'}, ${n} cena${n === 1 ? '' : 's'} cada.`);
    logEvent('batch', id, `Pedido: ${pathLabel(p.path)} · ${variationLabel(p.variation).toLowerCase()} · idioma ${languageName(p.language)} · ${optionsSummary({ word: p.word, bubbleOn: p.bubbleOn })} · cor ${p.bubbleColor}.`);
    logEvent('batch', id, viral ? `Estrutura vem do viral “${viral.name}” (guardado só neste computador).` : 'Sem viral: lote a partir da ideia escrita.');
    if (isSimulation()) {
      logEvent('batch', id, 'Simulação local ligada (⚙): nenhuma geração real e nenhuma chamada externa — as cenas avançam pelo relógio e o vídeo “pronto” é uma cópia do viral (ou um clipe de teste).', 'aviso');
    } else {
      logEvent('batch', id, 'Estado: na fila — aguardando o executor do Flow (fase futura). Nada foi enviado a lugar nenhum; o lote fica guardado até lá.', 'aviso');
    }
    return toBatchDTO(getBatchRow(id)!);
  });
}

/**
 * Lotes antigos (v1) ficaram sem vídeos: cria-os uma vez, no bootstrap.
 *
 * DECISÃO: entram PARADOS (state `parado` + stop_requested=1), nunca em `na_fila`. Um lote v1 foi guardado numa época
 * em que nada executava; se entrasse em `na_fila`, a simulação o rodaria sozinha no primeiro GET depois da migração,
 * sem o dono ter pedido. O dono decide em "Continuar de onde parou" (ou cancela/descarta).
 */
export function materializeLegacyBatches(): number {
  let n = 0;
  for (const b of listBatchRows()) {
    if (countVideos(b.id) > 0 || (b.state !== 'preparando' && b.state !== 'na_fila')) continue;
    transaction(() => {
      const viral = b.viral_id ? getViral(b.viral_id) : undefined;
      const nScenes = sceneCount(viral?.duration_s ?? null);
      for (let i = 0; i < b.quantity; i++) {
        insertVideo({ batchId: b.id, idx: i, title: `${b.title} · vídeo ${i + 1}`, scenes: Array.from({ length: nScenes }, (_, k) => ({ fala: `Cena ${k + 1}` })), avatarName: '' });
      }
      setStopRequested(b.id, true);
      setBatchState(b.id, 'parado');
      logEvent('batch', b.id, 'Lote de versão anterior atualizado: vídeos e cenas criados. Ele fica PARADO — nada é gerado sem você pedir; clique em Continuar de onde parou para iniciar (ou cancele/descarte).', 'aviso');
    });
    n++;
  }
  return n;
}

function videoRuns(rows: VideoRow[]): VideoRun[] {
  return rows.map((v) => ({
    id: v.id,
    idx: v.idx,
    state: v.state,
    scenesTotal: v.scenes_total,
    scenesDone: v.scenes_done,
    failScene: v.fail_scene,
    attempt: v.attempt,
    startedAt: v.started_at,
  }));
}

/** O arquivo que alimenta a simulação existe? (Lote sem viral usa o clipe embutido: sempre existe.) */
function sourceMissing(b: BatchRow): boolean {
  if (!b.viral_id) return false;
  const v = getViral(b.viral_id);
  return !!v && !fs.existsSync(viralFilePath(v.hash));
}

/** Avança a simulação até `now`. Idempotente e barato quando nada está ativo. */
export function tickBatches(now = Date.now()): void {
  if (!isSimulation()) return;
  const active = listActiveBatchRows();
  if (active.length === 0) return;
  const cfg = getSimConfig();
  transaction(() => {
    for (const b of active) {
      const rows = listVideoRows(b.id);
      const runs = videoRuns(rows);
      const changes = advanceVideos(runs, now, cfg, { stopRequested: !!b.stop_requested, sourceMissing: sourceMissing(b) });
      for (const c of changes) {
        patchVideo(c.id, c.patch);
        if (c.log) logEvent('batch', b.id, c.log.message, c.log.level);
      }
      const next = batchStateOf(applyChanges(runs, changes).map((v) => v.state), !!b.stop_requested);
      if (next !== b.state) {
        setBatchState(b.id, next);
        if (next === 'pronto' || next === 'falhou') {
          const done = rows.length;
          const ok = applyChanges(runs, changes).filter((v) => v.state === 'pronto').length;
          logEvent('batch', b.id, `Lote: produção encerrada — ${ok}/${done} pronto${ok === 1 ? '' : 's'}${next === 'falhou' ? `, ${done - ok} com falha (use ↻ Regerar)` : ''}.`, next === 'falhou' ? 'aviso' : 'info');
        } else if (next === 'parado') {
          logEvent('batch', b.id, 'Lote parado: os vídeos atuais terminaram e nenhum novo foi iniciado. Clique em Continuar de onde parou.');
        }
      }
    }
  });
}

/** PRODUÇÃO = lotes que não foram aprovados (→ Vídeos) nem descartados. */
export function listProduction(): BatchDTO[] {
  tickBatches();
  return listBatchRows().filter((b) => !b.archived).map((b) => toBatchDTO(b));
}

export function listAllBatches(): BatchDTO[] {
  tickBatches();
  return listBatchRows().map((b) => toBatchDTO(b));
}

export function conversationBatches(conversationId: string): BatchDTO[] {
  tickBatches();
  return listBatchRowsByConversation(conversationId).map((b) => toBatchDTO(b));
}

export function getBatchDTO(id: string): BatchDTO {
  tickBatches();
  const b = getBatchRow(id);
  if (!b) throw notFound('Lote');
  return toBatchDTO(b);
}

export function batchEvents(id: string): EventDTO[] {
  tickBatches();
  if (!getBatchRow(id)) throw notFound('Lote');
  return listEvents('batch', id, 400);
}

const need = (id: string): BatchRow => {
  const b = getBatchRow(id);
  if (!b) throw notFound('Lote');
  return b;
};

/** "✕ Cancelar agora" (o 2º clique de confirmação é da interface): esvazia a fila; o que já está pronto fica guardado. */
export function cancelBatch(id: string): BatchDTO {
  const b = need(id);
  if (b.state === 'cancelado') return toBatchDTO(b);
  const rows = listVideoRows(id);
  if (!rows.some((v) => v.state === 'fila' || v.state === 'gerando')) throw conflict('Esse lote já terminou: não há nada para cancelar.');
  transaction(() => {
    for (const v of rows) {
      if (v.state === 'gerando') patchVideo(v.id, { state: 'cancelado', error: 'cancelado (as cenas já prontas ficam guardadas)', startedAt: null });
      else if (v.state === 'fila') patchVideo(v.id, { state: 'cancelado', error: 'cancelado' });
    }
    setStopRequested(id, false);
    setBatchState(id, 'cancelado');
    logEvent('batch', id, `Lote ${id.slice(0, 8)}: cancelado agora — fila esvaziada; o que o Flow ainda devolver é ignorado. As cenas já prontas ficam guardadas.`, 'aviso');
  });
  return getBatchDTO(id);
}

/** "Parar depois dos atuais". */
export function stopBatch(id: string): BatchDTO {
  const b = need(id);
  if (b.state !== 'rodando' && b.state !== 'na_fila') throw conflict('Só dá para parar um lote em andamento.');
  transaction(() => {
    setStopRequested(id, true);
    logEvent('batch', id, `Lote ${id.slice(0, 8)}: vai parar quando os vídeos atuais terminarem; nenhum novo vídeo será iniciado.`);
  });
  tickBatches();
  return getBatchDTO(id);
}

/** "Continuar de onde parou". */
export function resumeBatch(id: string): BatchDTO {
  const b = need(id);
  if (b.state !== 'parado' && !b.stop_requested) throw conflict('Esse lote não está parado.');
  transaction(() => {
    setStopRequested(id, false);
    if (b.state === 'parado') setBatchState(id, 'na_fila');
    logEvent('batch', id, `Lote ${id.slice(0, 8)}: continuando de onde parou.`);
  });
  tickBatches();
  return getBatchDTO(id);
}

/** "↻ Regerar todas as cenas com falha" (ou só um vídeo, com `videoId`): só o que falta é gerado; as cenas prontas ficam. */
export function retryFailed(batchId: string, videoId?: string): BatchDTO {
  need(batchId);
  const failed = listVideoRows(batchId).filter((v) => v.state === 'falhou' && (!videoId || v.id === videoId));
  if (failed.length === 0) throw conflict('Nenhum vídeo com falha para refazer.');
  transaction(() => {
    for (const v of failed) patchVideo(v.id, { state: 'fila', error: '', failScene: null, finishedAt: null });
    setStopRequested(batchId, false);
    setBatchState(batchId, 'na_fila');
    logEvent(
      'batch',
      batchId,
      `Lote ${batchId.slice(0, 8)}: regerar ${videoId ? 'o vídeo com falha' : 'todas as cenas com falha'} — ${failed.length} vídeo(s); pedido enfileirado. As cenas prontas ficam, só as que faltam são geradas.`,
    );
  });
  tickBatches();
  return getBatchDTO(batchId);
}

/** "✓ Aprovar lote → Vídeos": tira o lote da Produção; os vídeos prontos ficam em Vídeos. */
export function approveBatch(id: string): BatchDTO {
  const b = need(id);
  if (listVideoRows(id).some((v) => v.state === 'fila' || v.state === 'gerando')) throw conflict('Espere o lote terminar (ou cancele) antes de aprovar.');
  transaction(() => {
    setArchived(id, true);
    logEvent('batch', id, `Lote “${b.title}” aprovado: saiu da Produção; os vídeos prontos ficam em Vídeos.`);
  });
  return toBatchDTO(getBatchRow(id)!);
}

/** "✕ Descartar lote": nada vai pra Vídeos e as cenas guardadas deste lote são apagadas. Cancela antes se estiver gerando. */
export function discardBatch(id: string): void {
  need(id);
  transaction(() => {
    deleteBatch(id); // vídeos saem em cascata
    deleteEvents('batch', id);
  });
}

/** Descarta um vídeo (sai da Produção e de Vídeos). Não vale para vídeo em andamento. */
export function removeVideo(videoId: string): void {
  const v = getVideoRow(videoId);
  if (!v) throw notFound('Vídeo');
  if (v.state === 'fila' || v.state === 'gerando') throw badRequest('Cancele o lote antes de descartar um vídeo em andamento.');
  transaction(() => {
    deleteVideo(videoId);
    logEvent('batch', v.batch_id, `Vídeo ${v.idx + 1} descartado (saiu da Produção e de Vídeos).`);
    if (countVideos(v.batch_id) === 0) {
      deleteBatch(v.batch_id);
      deleteEvents('batch', v.batch_id);
    }
  });
}

/** Cartões de "MEUS VÍDEOS": só os prontos, agrupados por lote (o mais novo primeiro). */
export interface ReadyGroup {
  batchId: string;
  title: string;
  createdAt: string;
  videos: VideoDTO[];
}
export function listReadyGroups(): ReadyGroup[] {
  tickBatches();
  const groups = new Map<string, ReadyGroup>();
  for (const v of listReadyVideoRows()) {
    let g = groups.get(v.batch_id);
    if (!g) {
      const b = getBatchRow(v.batch_id);
      if (!b) continue;
      g = { batchId: b.id, title: b.batch_name || b.title, createdAt: b.created_at, videos: [] };
      groups.set(b.id, g);
    }
    g.videos.push(toVideoDTO(v, getBatchRow(v.batch_id)!.batch_name));
  }
  return [...groups.values()];
}

export type MediaSource = { kind: 'file'; path: string; size: number; name: string } | { kind: 'bytes'; bytes: Uint8Array; size: number; name: string };

function sourceFor(b: BatchRow, name: string): MediaSource {
  const viral = b.viral_id ? getViral(b.viral_id) : undefined;
  if (viral) {
    const p = viralFilePath(viral.hash);
    if (fs.existsSync(p)) return { kind: 'file', path: p, size: fs.statSync(p).size, name };
  }
  return { kind: 'bytes', bytes: PLACEHOLDER_MP4, size: PLACEHOLDER_MP4.length, name };
}

/** Arquivo para baixar um vídeo PRONTO. Nesta fase é a cópia simulada (viral ou clipe de teste). */
export function videoMedia(videoId: string): MediaSource {
  tickBatches();
  const v = getVideoRow(videoId);
  if (!v) throw notFound('Vídeo');
  if (v.state !== 'pronto') throw conflict('Esse vídeo ainda não está pronto.');
  const b = need(v.batch_id);
  return sourceFor(b, toVideoDTO(v, b.batch_name).downloadName);
}

/** Entradas do zip "Baixar todos os prontos (N)" de um lote. */
export function readyZipEntries(batchId: string): { name: string; entries: ZipEntry[] } {
  tickBatches();
  const b = need(batchId);
  const ready = listVideoRows(batchId).filter((v) => v.state === 'pronto');
  if (ready.length === 0) throw conflict('Nenhum vídeo pronto neste lote.');
  const names = uniqueNames(ready.map((v) => safeZipName(toVideoDTO(v, b.batch_name).downloadName, `video-${v.idx + 1}.mp4`)));
  const entries = ready.map((v, i): ZipEntry => {
    const src = sourceFor(b, names[i]);
    return src.kind === 'bytes' ? { name: names[i], data: src.bytes } : { name: names[i], data: () => fs.createReadStream(src.path) };
  });
  return { name: `${safeZipName(b.batch_name || b.title, 'lote')}.zip`, entries };
}

/** "↻ Tentar de novo" num vídeo (resolve o lote pelo vídeo). */
export function retryVideoById(videoId: string): BatchDTO {
  const v = getVideoRow(videoId);
  if (!v) throw notFound('Vídeo');
  return retryFailed(v.batch_id, videoId);
}
