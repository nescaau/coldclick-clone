/**
 * Execução REAL dos vídeos (Flow, pela extensão): o lado do SERVIDOR.
 *
 * A página do Zerum é quem fala com a extensão; o servidor decide O QUE executar e GUARDA o resultado:
 *   claimWork     → reserva a próxima cena (um clipe de até 8 s) para a aba líder executar;
 *   sceneProgress → a aba avisa que a ordem existe na extensão e renova a reserva (e descobre se deve parar);
 *   acceptClip    → o MP4 baixado do Flow chega aqui; a cena fica pronta; na última, o vídeo é montado e fica PRONTO;
 *   failScene     → a cena falhou (cota, conteúdo recusado…) → o vídeo falha, ou volta à fila se a troca automática ligou.
 *
 * Regras que não mudam:
 *  - uma cena por vez em cada vídeo; até "Vídeos simultâneos" vídeos ao mesmo tempo;
 *  - nada é gerado sem fala/assunto (o prompt é validado ANTES de gastar crédito);
 *  - reenviar/retomar uma cena usa a MESMA chave (a extensão devolve a mesma ordem — nunca uma geração nova);
 *  - o arquivo "pronto" é SEMPRE um MP4 baixado do Flow (data/flow/<hash>.mp4): jamais uma cópia do viral.
 */
import { BASE_PATH } from '../config.shared';
import { transaction } from '../db';
import { AppError, badRequest, conflict, notFound } from '../errors';
import { readAnalysis } from '../domain/analysis';
import { untilLabel } from '../domain/clock-label';
import { buildScenePrompt, type PromptAvatar } from '../domain/flow-prompt';
import { looksLikeMp4, parseMp4Meta } from '../domain/mp4';
import { concatMp4 } from '../domain/mp4-concat';
import { LEASE_MS, doneCount, leaseHeldBy, newRun, nextScene, parseRun, sceneJobId, sceneOpKey, type RealRun, type RealScene } from '../domain/real-run';
import { listAvatarRows } from '../repo/avatars';
import { getBatchRow, listClaimableBatchRows, type BatchRow } from '../repo/batches';
import { logEvent } from '../repo/events';
import { countRealRunning, getVideoRow, listRealRunningRows, listVideoRows, patchVideo, setVideoReal, type VideoRow } from '../repo/videos';
import { getViral } from '../repo/virals';
import type { ClaimResponse, ClipResponse, FailResponse, ProgressResponse, SceneWork } from '../bridge/work';
import type { VideoDTO } from '../types';
import { executionMode, isLeader } from './bridge-service';
import { readClip, storeClip } from './flow-files';
import { parseScenes, refreshBatchState, toVideoDTO } from './production-service';
import { getSettings } from './settings-service';

/** Teto de um clipe de cena (o de um clipe de 8 s fica muito abaixo; também cabe no buffer do middleware, 70 MB). */
export const MAX_CLIP_BYTES = 64 * 1024 * 1024;

/** "7,3 MB" / "812 KB" — clipe pequeno não pode aparecer como "0,0 MB". */
const fmtSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const ext = (mime: string | null) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

const readRun = (v: VideoRow): RealRun => parseRun(v.real_json, v.scenes_total) ?? newRun(v.scenes_total);

function saveRun(v: VideoRow, run: RealRun, extra: Parameters<typeof patchVideo>[1] = {}): void {
  setVideoReal(v.id, { mode: 'real', real: JSON.stringify(run) });
  patchVideo(v.id, { scenesDone: doneCount(run), ...extra });
}

const dto = (videoId: string): VideoDTO => {
  const v = getVideoRow(videoId)!;
  return toVideoDTO(v, getBatchRow(v.batch_id)!.batch_name);
};

// ─── montagem do pedido de uma cena ──────────────────────────────────────────────────────────────────────────────────

function avatarFor(v: VideoRow): { avatar: PromptAvatar | null; reference: SceneWork['reference'] } {
  if (!v.avatar_name) return { avatar: null, reference: null };
  const row = listAvatarRows().find((r) => r.name.trim().toLowerCase() === v.avatar_name.trim().toLowerCase());
  if (!row) return { avatar: { name: v.avatar_name, description: '', gender: '', hasPhoto: false }, reference: null };
  const hasPhoto = !!row.photo_hash;
  return {
    avatar: { name: row.name, description: row.description, gender: row.gender, hasPhoto },
    reference: hasPhoto ? { avatarId: row.id, mimeType: (row.photo_mime ?? 'image/jpeg') as NonNullable<SceneWork['reference']>['mimeType'], name: `${row.name}.${ext(row.photo_mime)}` } : null,
  };
}

/** Prompt da cena `idx` (ou o motivo de não poder gerar). */
function promptFor(b: BatchRow, v: VideoRow, idx: number) {
  const viral = b.viral_id ? getViral(b.viral_id) : undefined;
  const { avatar } = avatarFor(v);
  return buildScenePrompt({
    language: b.language,
    sceneIdx: idx,
    sceneCount: v.scenes_total,
    fala: parseScenes(v.scenes)[idx]?.fala ?? '',
    path: b.path,
    variation: b.variation,
    avatar,
    analysis: viral ? readAnalysis(viral.analysis) : null,
    notes: b.notes,
  });
}

function toWork(b: BatchRow, v: VideoRow, idx: number, s: RealScene, resume: boolean): SceneWork {
  return {
    videoId: v.id,
    batchId: b.id,
    sceneIdx: idx,
    sceneCount: v.scenes_total,
    jobId: sceneJobId(v.id, idx),
    opKey: s.opKey,
    attempt: s.attempt,
    accountId: s.accountId,
    resume,
    args: { prompt: s.prompt, aspectRatio: '9:16', durationSeconds: 8 },
    reference: avatarFor(v).reference,
    label: `Vídeo ${v.idx + 1} · cena ${idx + 1}/${v.scenes_total}`,
  };
}

// ─── reservar trabalho ───────────────────────────────────────────────────────────────────────────────────────────────

/** Reserva a cena `idx` para `pumpId` na conta `accountId` (cena nova: gera o prompt e a chave). Devolve null se o prompt não serve. */
function startScene(b: BatchRow, v: VideoRow, run: RealRun, idx: number, accountId: string, pumpId: string, now: number): SceneWork | null {
  const s = run.scenes[idx];
  const p = promptFor(b, v, idx);
  if (!p.ok) {
    failVideo(b, v, run, idx, p.error);
    return null;
  }
  Object.assign(s, { state: 'gerando', accountId, prompt: p.prompt, opKey: sceneOpKey(v.id, idx, s.attempt, p.prompt), orderId: '', error: '', pumpId, leaseUntil: now + LEASE_MS, startedAt: now, finishedAt: 0 });
  saveRun(v, run);
  logEvent('batch', b.id, `Vídeo ${v.idx + 1}: gerando a cena ${idx + 1}/${v.scenes_total} no Flow (conta ${accountId})${s.attempt ? ` — tentativa ${s.attempt + 1}` : ''}.`);
  return toWork(b, v, idx, s, false);
}

/** O vídeo não pode ser gerado (ex.: cena sem fala): falha ANTES de gastar crédito, com a causa. */
function failVideo(b: BatchRow, v: VideoRow, run: RealRun, idx: number | null, message: string): void {
  saveRun(v, run, { state: 'falhou', failScene: idx, error: message, finishedAt: Date.now() });
  logEvent('batch', b.id, `Vídeo ${v.idx + 1}: FALHOU — ${message}`, 'erro');
  refreshBatchState(b.id);
}

/** Começa (ou retoma) um vídeo que estava na fila. */
function startVideo(b: BatchRow, v: VideoRow, accountId: string, pumpId: string, now: number): SceneWork | null {
  const retrying = v.mode === 'real' && !!v.real_json;
  const run = retrying ? readRun(v) : newRun(v.scenes_total);

  // Valida o roteiro de TODAS as cenas que faltam antes de gastar o primeiro crédito.
  for (let i = 0; i < run.scenes.length; i++) {
    if (run.scenes[i].state === 'pronto') continue;
    const p = promptFor(b, v, i);
    if (!p.ok) {
      failVideo(b, v, run, i, p.error);
      return null;
    }
  }
  // Cenas que falharam numa tentativa anterior voltam para a fila (tentativa + 1); as prontas ficam.
  for (const s of run.scenes) {
    if (s.state === 'falhou') Object.assign(s, { state: 'fila', attempt: s.attempt + 1, opKey: '', orderId: '', error: '', prompt: '' });
  }
  saveRun(v, run, { state: 'gerando', attempt: v.attempt + 1, startedAt: now, failScene: null, error: '', finishedAt: null });
  const fresh = getVideoRow(v.id)!;
  const idx = nextScene(run);
  logEvent('batch', b.id, `Vídeo ${v.idx + 1}: começou a gerar de verdade no Flow (${v.scenes_total} cena${v.scenes_total === 1 ? '' : 's'}${idx > 0 ? `, retomando da cena ${idx + 1}` : ''}). Cada clipe gasta crédito da conta; o vídeo pronto é o MP4 baixado de lá.`);
  refreshBatchState(b.id);
  if (idx === -1) {
    finalizeVideo(b, fresh, run, now); // tudo já estava baixado (ex.: só faltava juntar): 0 crédito
    return null;
  }
  return startScene(b, fresh, run, idx, accountId, pumpId, now);
}

/**
 * Próxima cena para a aba líder. `accountId` = conta que a página escolheu para cenas NOVAS; `available` = contas onde ela
 * consegue retomar cenas já em voo (a ordem vive na conta onde nasceu).
 */
export function claimWork(i: { pumpId: string; accountId: string; available: string[] }, now = Date.now()): ClaimResponse {
  const mode = executionMode(now);
  const none = (reason: string): ClaimResponse => ({ work: null, reason, mode });
  if (mode === 'simulado') return none('SIMULACAO_LIGADA');
  if (mode === 'espera') return none('EXTENSAO_NAO_CONECTADA');
  if (!isLeader(i.pumpId, now)) return none('OUTRA_ABA_EXECUTANDO');
  const avail = new Set(i.available.map((a) => a.toLowerCase()));
  const account = i.accountId.toLowerCase();

  return transaction((): ClaimResponse => {
    // 1) vídeos já em execução: retomar cena em voo (conta fixada) ou começar a próxima cena.
    let waiting = '';
    for (const v0 of listRealRunningRows()) {
      const b = getBatchRow(v0.batch_id);
      if (!b) continue;
      const run = readRun(v0);
      const idx = nextScene(run);
      if (idx === -1) {
        finalizeVideo(b, v0, run, now);
        continue;
      }
      const s = run.scenes[idx];
      if (s.state === 'gerando') {
        if (leaseHeldBy(s, i.pumpId, now)) continue; // esta aba já está executando
        if (!avail.has(s.accountId.toLowerCase())) {
          waiting = `CONTA_DA_CENA_INDISPONIVEL; a cena ${idx + 1} do vídeo ${v0.idx + 1} está em voo na conta ${s.accountId}, que não está disponível agora`;
          continue;
        }
        Object.assign(s, { pumpId: i.pumpId, leaseUntil: now + LEASE_MS });
        saveRun(v0, run);
        return { work: toWork(b, v0, idx, s, true), reason: '', mode };
      }
      if (!account) {
        waiting = 'SEM_CONTA_ESCOLHIDA';
        continue;
      }
      const work = startScene(b, v0, run, idx, account, i.pumpId, now);
      if (work) return { work, reason: '', mode };
    }

    // 2) vídeo novo, se houver vaga ("Vídeos simultâneos") e conta.
    if (countRealRunning() >= getSettings().parallel) return none(waiting || 'LIMITE_SIMULTANEOS');
    if (!account) return none(waiting || 'SEM_CONTA_ESCOLHIDA');
    for (const b of listClaimableBatchRows()) {
      for (const v of listVideoRows(b.id).filter((x) => x.state === 'fila')) {
        const work = startVideo(b, v, account, i.pumpId, now);
        if (work) return { work, reason: '', mode };
        if (countRealRunning() >= getSettings().parallel) return none('LIMITE_SIMULTANEOS');
      }
    }
    return none(waiting || 'SEM_TRABALHO');
  });
}

// ─── resultado ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Active {
  b: BatchRow;
  v: VideoRow;
  run: RealRun;
  s: RealScene;
}

/** A cena ainda é desta aba e está em voo? Senão devolve o motivo. */
function active(videoId: string, idx: number, pumpId: string, now: number): Active | string {
  const v = getVideoRow(videoId);
  if (!v) return 'VIDEO_REMOVIDO';
  const b = getBatchRow(v.batch_id);
  if (!b) return 'LOTE_REMOVIDO';
  if (v.mode !== 'real' || v.state !== 'gerando') return 'VIDEO_NAO_ESTA_GERANDO';
  const run = readRun(v);
  const s = run.scenes[idx];
  if (!s || s.state !== 'gerando') return 'CENA_NAO_ESTA_GERANDO';
  if (s.pumpId !== pumpId && s.leaseUntil > now) return 'OUTRA_ABA_ASSUMIU';
  return { b, v, run, s };
}

/** A aba confirma que a ordem existe na extensão (guarda o id) e renova a reserva. `continue:false` = pare de acompanhar. */
export function sceneProgress(i: { videoId: string; idx: number; pumpId: string; orderId: string }, now = Date.now()): ProgressResponse {
  const a = active(i.videoId, i.idx, i.pumpId, now);
  if (typeof a === 'string') return { continue: false, reason: a };
  const { v, run, s } = a;
  if (i.orderId && s.orderId !== i.orderId) s.orderId = i.orderId;
  Object.assign(s, { pumpId: i.pumpId, leaseUntil: now + LEASE_MS });
  saveRun(v, run);
  return { continue: true, reason: '' };
}

/** O MP4 baixado do Flow chegou. A cena fica pronta; na última cena o vídeo é montado e fica PRONTO. */
export function acceptClip(i: { videoId: string; idx: number; pumpId: string; orderId: string; mediaRef: string; bytes: Uint8Array }, now = Date.now()): ClipResponse {
  if (i.bytes.length === 0) throw badRequest('O vídeo veio vazio.');
  if (i.bytes.length > MAX_CLIP_BYTES) throw new AppError(413, `O clipe da cena passa de ${MAX_CLIP_BYTES / 1024 / 1024} MB.`);
  if (!looksLikeMp4(i.bytes.subarray(0, 12))) throw badRequest('O arquivo recebido não parece um MP4.');
  const a = active(i.videoId, i.idx, i.pumpId, now);
  if (typeof a === 'string') {
    const v = getVideoRow(i.videoId);
    if (!v) throw notFound('Vídeo');
    throw conflict(a === 'VIDEO_NAO_ESTA_GERANDO' ? 'Este vídeo foi cancelado (ou já terminou): o que o Flow devolveu foi ignorado.' : `Esta cena não está mais com esta aba (${a}).`);
  }
  const { b, v, run, s } = a;
  const stored = storeClip(i.bytes);
  Object.assign(s, { state: 'pronto', hash: stored.hash, size: stored.size, mediaRef: i.mediaRef.slice(0, 120), orderId: i.orderId || s.orderId, error: '', finishedAt: now, leaseUntil: 0 });
  return transaction(() => {
    saveRun(v, run);
    const meta = parseMp4Meta(i.bytes);
    logEvent('batch', b.id, `Vídeo ${v.idx + 1}: cena ${i.idx + 1}/${v.scenes_total} pronta — clipe baixado do Flow (${fmtSize(stored.size)}${meta?.durationS ? `, ${meta.durationS}s` : ''}).`);
    const finished = nextScene(run) === -1;
    if (finished) finalizeVideo(b, getVideoRow(v.id)!, run, now);
    return { video: dto(v.id), finished: finished && getVideoRow(v.id)!.state === 'pronto' };
  });
}

/** Todas as cenas têm MP4: monta o final (a própria cena, ou as cenas juntadas) e marca o vídeo PRONTO. */
function finalizeVideo(b: BatchRow, v: VideoRow, run: RealRun, now: number): void {
  const n = run.scenes.length;
  let clips: Uint8Array[];
  try {
    clips = run.scenes.map((s) => readClip(s.hash));
  } catch {
    // Um clipe sumiu do disco: essa cena volta para a fila (será gerada de novo, o que gasta crédito) e o usuário é avisado.
    const lost = run.scenes.findIndex((s) => {
      try {
        readClip(s.hash);
        return false;
      } catch {
        return true;
      }
    });
    Object.assign(run.scenes[lost], { state: 'falhou', error: 'O arquivo do clipe sumiu deste computador.', hash: '', size: 0 });
    failVideo(b, v, run, lost, `O clipe da cena ${lost + 1} não está mais neste computador. Use ↻ Tentar de novo: só essa cena será gerada de novo (gasta crédito do Flow).`);
    return;
  }
  let final: { hash: string; size: number; joined: boolean };
  if (n === 1) {
    final = { hash: run.scenes[0].hash, size: run.scenes[0].size, joined: false };
  } else {
    try {
      const joined = storeClip(concatMp4(clips));
      final = { ...joined, joined: true };
    } catch (e) {
      const why = e instanceof Error ? e.message : 'formato inesperado';
      failVideo(b, v, run, null, `As ${n} cenas foram geradas e baixadas, mas não consegui juntá-las num só MP4 (${why}). As cenas ficaram guardadas: use ↻ Tentar de novo para tentar juntar de novo (0 crédito).`);
      return;
    }
  }
  run.final = final;
  const meta = parseMp4Meta(readClip(final.hash));
  saveRun(v, run, { state: 'pronto', failScene: null, error: '', finishedAt: now });
  const accounts = [...new Set(run.scenes.map((s) => s.accountId).filter(Boolean))].join(', ');
  logEvent('batch', b.id, `Vídeo ${v.idx + 1}: PRONTO (${n} cena${n === 1 ? '' : 's'}) — MP4 baixado do Flow (conta ${accounts}), ${fmtSize(final.size)}${meta?.durationS ? `, ${meta.durationS}s` : ''}${final.joined ? ', cenas juntadas' : ''}.`);
  refreshBatchState(b.id);
}

/** Texto honesto para a falha de uma cena, por tipo de causa. */
function failureMessage(i: { code: string; message: string; kind: 'cota' | 'incomum' | 'outro'; retryAt?: number }, scene1: number, account: string): string {
  if (i.kind === 'cota') {
    return `A conta do Flow ${account} atingiu a cota${i.retryAt ? ` e fica em pausa até ${untilLabel(i.retryAt)}` : ' (pausa de 24 h)'} — cena ${scene1}. O Zerum não troca de conta sozinho para furar a cota: ligue a troca automática em “Contas Flow” (se tiver outra conta) ou espere e use ↻ Tentar de novo.`;
  }
  if (i.kind === 'incomum') return `O Google recusou a cena ${scene1} por atividade incomum na conta ${account} (pausa de 5 min). Espere um pouco e use ↻ Tentar de novo — as cenas prontas ficam.`;
  if (/CREDITOS_INSUFICIENTES/.test(i.code)) return `A conta ${account} está sem créditos do Flow — cena ${scene1}. Escolha outra conta em “Contas Flow” (ou ligue a troca automática) e use ↻ Tentar de novo.`;
  if (/CONTEUDO_RECUSADO/.test(i.code)) return `O Flow recusou o conteúdo da cena ${scene1} (política de segurança dele). Ajuste a fala/observações e use ↻ Tentar de novo.`;
  return `O Flow não conseguiu gerar a cena ${scene1} (${i.code}${i.message ? `: ${i.message}` : ''}). Nada foi reenviado sozinho. Use ↻ Tentar de novo — as cenas prontas ficam.`;
}

/** A cena falhou. Com a troca automática ligada e falha de cota/atividade, ela volta à fila para outra conta; senão o vídeo falha. */
export function failScene(i: { videoId: string; idx: number; pumpId: string; orderId: string; code: string; message: string; kind: 'cota' | 'incomum' | 'outro'; retryAt?: number }, now = Date.now()): FailResponse {
  const a = active(i.videoId, i.idx, i.pumpId, now);
  if (typeof a === 'string') {
    if (!getVideoRow(i.videoId)) throw notFound('Vídeo');
    throw conflict(`Esta cena não está mais com esta aba (${a}).`);
  }
  const { b, v, run, s } = a;
  const msg = failureMessage(i, i.idx + 1, s.accountId);
  return transaction((): FailResponse => {
    if (i.orderId) s.orderId = i.orderId;
    const requeue = getSettings().autoSwitch && i.kind !== 'outro';
    if (requeue) {
      // A ordem ruim fica terminal na extensão; a próxima tentativa abre outra (beginAttempt) numa conta que sirva.
      Object.assign(s, { state: 'fila', attempt: s.attempt + 1, opKey: '', orderId: '', prompt: '', pumpId: '', leaseUntil: 0, error: msg });
      saveRun(v, run, { state: 'fila', startedAt: null });
      logEvent('batch', b.id, `Vídeo ${v.idx + 1}: ${msg} A troca automática vai tentar outra conta.`, 'aviso');
    } else {
      Object.assign(s, { state: 'falhou', error: msg, finishedAt: now, pumpId: '', leaseUntil: 0 });
      saveRun(v, run, { state: 'falhou', failScene: i.idx, error: msg, finishedAt: now });
      logEvent('batch', b.id, `Vídeo ${v.idx + 1}: FALHOU — ${msg}`, 'erro');
    }
    refreshBatchState(b.id);
    return { video: dto(v.id), requeued: requeue };
  });
}
