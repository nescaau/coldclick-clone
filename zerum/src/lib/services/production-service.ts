/**
 * Produção: lotes → vídeos → cenas. Persistido em SQLite; o log de cada lote é gravado em `events` (tempo real: a UI lê
 * a cada ~1,5 s).
 *
 * QUEM GERA (ver `executionMode` em bridge-service.ts):
 *  - SIMULADO (⚙ → "Simulação local" ligada): o relógio faz cada cena "ficar pronta" depois de `sceneMs`, e o vídeo "pronto"
 *    é uma CÓPIA do viral (ou um clipe de teste). Isso é sempre dito no log e no cartão do vídeo (selo SIMULADO).
 *  - REAL (simulação desligada + extensão pronta): quem avança é a ponte — a página reserva uma cena por vez
 *    (real-service.ts), a extensão gera no Flow e o MP4 baixado de lá vira o vídeo "pronto" (sem selo SIMULADO).
 *  - ESPERA (simulação desligada, sem extensão): o lote fica "na fila" — nada avança sozinho.
 *
 * O avanço SIMULADO é por LEITURA (`tick`): sem timers nem processos em segundo plano. Cada GET de produção/vídeos chama `tick`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { VIRALS_DIR } from '../config';
import path from 'node:path';
import { transaction } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { splitSpeech, readAnalysis } from '../domain/analysis';
import { pathLabel, variationLabel, type PlanParams } from '../domain/plan';
import { parseRun } from '../domain/real-run';
import { placeholderScript } from '../domain/flow-prompt';
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
import { countVideos, deleteVideo, getVideoRow, insertVideo, listReadyVideoRows, listVideoRows, patchVideo, setVideoReal, type VideoRow } from '../repo/videos';
import { getViral } from '../repo/virals';
import type { BatchDTO, EventDTO, VideoDTO } from '../types';
import { bumpRoleta, getSimConfig } from './settings-service';
import { executionMode } from './bridge-service';
import { clipExists, dropVideoFiles, flowFilePath, hashesOf } from './flow-files';
import { PLACEHOLDER_MP4 } from './placeholder-clip';
import type { ZipEntry } from '../domain/zip';
import { safeZipName, uniqueNames } from '../domain/zip';

export const viralFilePath = (hash: string): string => path.join(VIRALS_DIR, `${hash}.mp4`);

const batchHash = (id: string) => crypto.createHash('sha256').update(id).digest('hex');

export const parseScenes = (raw: string): { fala: string }[] => {
  try {
    const p = JSON.parse(raw) as { fala?: unknown }[];
    return Array.isArray(p) ? p.map((s) => ({ fala: typeof s?.fala === 'string' ? s.fala : '' })) : [];
  } catch {
    return [];
  }
};

export function toVideoDTO(v: VideoRow, batchName: string): VideoDTO {
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
    // Só o vídeo gerado pelo Flow (mode 'real') deixa de ser "simulado". Os demais — inclusive os que ainda estão na fila — são.
    simulated: v.mode !== 'real',
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
    if (input.params.path === 'adaptar') return { fala: placeholderScript('adaptar', k) };
    return { fala: chunks[i] || placeholderScript('vazio', k) };
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
    const mode = executionMode();
    if (mode === 'simulado') {
      logEvent('batch', id, 'Simulação local ligada (⚙): nenhuma geração real e nenhuma chamada externa — as cenas avançam pelo relógio e o vídeo “pronto” é uma cópia do viral (ou um clipe de teste).', 'aviso');
    } else if (mode === 'real') {
      logEvent('batch', id, 'Estado: na fila — o Flow (extensão conectada) vai gerar de verdade, uma cena de cada vez, na sua conta. Cada clipe gasta crédito do Flow; o vídeo pronto é o MP4 baixado de lá.');
    } else {
      logEvent('batch', id, 'Estado: na fila — aguardando o executor do Flow (EXTENSAO_NAO_INSTALADA: conecte a extensão do Zerum). Nada foi enviado a lugar nenhum; o lote fica guardado até lá.', 'aviso');
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

/**
 * Recalcula o estado do lote a partir dos vídeos e registra no log quando ele muda (encerrado / parado).
 * Usado pela simulação (`tickBatches`) e pela execução real (real-service.ts) — a regra é uma só.
 * `states` = os estados que os vídeos TERÃO (a simulação ainda não gravou as mudanças quando chama).
 */
export function settleBatchState(b: BatchRow, states: readonly VideoRun['state'][]): void {
  const next = batchStateOf(states, !!b.stop_requested);
  if (next === b.state) return;
  setBatchState(b.id, next);
  if (next === 'pronto' || next === 'falhou') {
    const done = states.length;
    const ok = states.filter((s) => s === 'pronto').length;
    logEvent('batch', b.id, `Lote: produção encerrada — ${ok}/${done} pronto${ok === 1 ? '' : 's'}${next === 'falhou' ? `, ${done - ok} com falha (use ↻ Regerar)` : ''}.`, next === 'falhou' ? 'aviso' : 'info');
  } else if (next === 'parado') {
    logEvent('batch', b.id, 'Lote parado: os vídeos atuais terminaram e nenhum novo foi iniciado. Clique em Continuar de onde parou.');
  }
}

/** Relê o lote e acomoda o estado (a execução real chama isto depois de mexer num vídeo). */
export function refreshBatchState(batchId: string): void {
  const b = getBatchRow(batchId);
  if (b) settleBatchState(b, listVideoRows(batchId).map((v) => v.state));
}

/**
 * Avança a SIMULAÇÃO até `now`. Idempotente e barato quando nada está ativo.
 * Só roda com a simulação ligada (⚙); na execução real quem avança é a ponte, e sem extensão nada avança.
 * Vídeos já em execução REAL (mode 'real') nunca são simulados.
 */
export function tickBatches(now = Date.now()): void {
  if (executionMode(now) !== 'simulado') return;
  const active = listActiveBatchRows();
  if (active.length === 0) return;
  const cfg = getSimConfig();
  transaction(() => {
    for (const b of active) {
      const rows = listVideoRows(b.id);
      const simRows = rows.filter((v) => v.mode !== 'real');
      const realStates = rows.filter((v) => v.mode === 'real').map((v) => v.state);
      const runs = videoRuns(simRows);
      const changes = advanceVideos(runs, now, cfg, { stopRequested: !!b.stop_requested, sourceMissing: sourceMissing(b) });
      for (const c of changes) {
        patchVideo(c.id, c.patch);
        if (c.log) logEvent('batch', b.id, c.log.message, c.log.level);
      }
      settleBatchState(b, [...applyChanges(runs, changes).map((v) => v.state), ...realStates]);
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
  const allFailed = listVideoRows(batchId).filter((v) => v.state === 'falhou' && (!videoId || v.id === videoId));
  if (allFailed.length === 0) throw conflict('Nenhum vídeo com falha para refazer.');
  const simulating = executionMode() === 'simulado';
  // Com a simulação ligada, um vídeo REAL que já tem cenas baixadas (pagas) NUNCA é convertido em simulado: isso apagaria os
  // clipes que custaram crédito. Ele fica como está até a simulação ser desligada (aí só as cenas que faltam são geradas).
  const paidReal = (v: VideoRow) => simulating && v.mode === 'real' && hashesOf(v).length > 0;
  const failed = allFailed.filter((v) => !paidReal(v));
  if (failed.length === 0) throw conflict('Esse vídeo já tem cenas reais baixadas do Flow. Para não perder o que foi gasto, desligue a simulação (⚙) e tente de novo: só as cenas que faltam serão geradas.');
  transaction(() => {
    for (const v of failed) {
      // Um vídeo que falhou no Flow SEM nenhuma cena baixada e é refeito com a simulação ligada vira simulado (senão ficaria parado na fila).
      // Com a simulação desligada ele continua REAL: as cenas já baixadas ficam, só as que faltam são geradas.
      if (v.mode === 'real' && simulating) {
        setVideoReal(v.id, { mode: 'sim', real: '' });
        patchVideo(v.id, { scenesDone: 0 });
      }
      patchVideo(v.id, { state: 'fila', error: '', failScene: null, finishedAt: null });
    }
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
  const rows = listVideoRows(id);
  transaction(() => {
    deleteBatch(id); // vídeos saem em cascata
    deleteEvents('batch', id);
  });
  for (const v of rows) dropVideoFiles(v); // os clipes do Flow deste lote (depois: se a transação falhar, nada some)
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
  dropVideoFiles(v); // os clipes do Flow deste vídeo (só os que nenhum outro vídeo usa)
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

/** O MP4 final de um vídeo REAL (baixado do Flow). Some do disco → conflito claro, nunca uma cópia disfarçada. */
function realSource(v: VideoRow, name: string): MediaSource {
  const hash = parseRun(v.real_json, v.scenes_total)?.final?.hash ?? '';
  if (!hash || !clipExists(hash)) throw conflict('O arquivo deste vídeo não está mais neste computador. Use ↻ Tentar de novo para gerar de novo as cenas que faltam.');
  const p = flowFilePath(hash);
  return { kind: 'file', path: p, size: fs.statSync(p).size, name };
}

function sourceFor(b: BatchRow, v: VideoRow, name: string): MediaSource {
  if (v.mode === 'real') return realSource(v, name);
  const viral = b.viral_id ? getViral(b.viral_id) : undefined;
  if (viral) {
    const p = viralFilePath(viral.hash);
    if (fs.existsSync(p)) return { kind: 'file', path: p, size: fs.statSync(p).size, name };
  }
  return { kind: 'bytes', bytes: PLACEHOLDER_MP4, size: PLACEHOLDER_MP4.length, name };
}

/** Arquivo para baixar um vídeo PRONTO: o MP4 baixado do Flow (real) ou a cópia simulada (viral ou clipe de teste). */
export function videoMedia(videoId: string): MediaSource {
  tickBatches();
  const v = getVideoRow(videoId);
  if (!v) throw notFound('Vídeo');
  if (v.state !== 'pronto') throw conflict('Esse vídeo ainda não está pronto.');
  const b = need(v.batch_id);
  return sourceFor(b, v, toVideoDTO(v, b.batch_name).downloadName);
}

/** Entradas do zip "Baixar todos os prontos (N)" de um lote. */
export function readyZipEntries(batchId: string): { name: string; entries: ZipEntry[] } {
  tickBatches();
  const b = need(batchId);
  const ready = listVideoRows(batchId).filter((v) => v.state === 'pronto');
  if (ready.length === 0) throw conflict('Nenhum vídeo pronto neste lote.');
  const names = uniqueNames(ready.map((v) => safeZipName(toVideoDTO(v, b.batch_name).downloadName, `video-${v.idx + 1}.mp4`)));
  const entries = ready.map((v, i): ZipEntry => {
    const src = sourceFor(b, v, names[i]);
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
