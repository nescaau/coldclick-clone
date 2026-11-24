import { getSetting, setSetting, deleteSetting } from '../repo/settings';
import { DEFAULT_SETTINGS, type SettingsDTO } from '../types';
import { DEFAULT_BALLOON_COLOR, normalizeHex } from '../domain/video-options';
import { BRAIN_OPTIONS, IMAGE_MODEL_OPTIONS, PARALLEL_OPTIONS, maskKey, normalizeBrain, normalizeImageModel, sanitizeSubtitle, type SubtitleSettings } from '../domain/settings';
import { ROLETA_TOTAL } from '../domain/plan';
import type { SimConfig } from '../domain/production';
import { badRequest } from '../errors';

/** Duração simulada de cada cena (ms). `ZERUM_SIM_SCENE_MS` serve ao smoke/testes; o padrão deixa ver o progresso. */
const sceneMsFromEnv = (): number => {
  const n = Number(process.env.ZERUM_SIM_SCENE_MS);
  return Number.isFinite(n) && n > 0 ? n : 2500;
};

export type SettingsPatch = Partial<Omit<SettingsDTO, 'subtitle' | 'apiKeyMasked' | 'roletaUsed'>> & { subtitle?: Partial<SubtitleSettings> };

export function getSettings(): SettingsDTO {
  const key = getSetting<string>('apiKey', '');
  // Migração de uma linha: o valor salvo "Nano Banana Lite" (versão anterior) vira o nome real "Nano Banana 2 Lite".
  const imageRaw = getSetting<string>('imageModel', DEFAULT_SETTINGS.imageModel);
  const imageModel = normalizeImageModel(imageRaw);
  if (imageModel !== imageRaw) setSetting('imageModel', imageModel);
  return {
    autoSwitch: getSetting('autoSwitch', DEFAULT_SETTINGS.autoSwitch),
    minCredits: getSetting('minCredits', DEFAULT_SETTINGS.minCredits),
    parallel: getSetting('parallel', DEFAULT_SETTINGS.parallel),
    imageModel,
    brain: normalizeBrain(getSetting('brain', DEFAULT_SETTINGS.brain)),
    flowCopy: getSetting('flowCopy', DEFAULT_SETTINGS.flowCopy),
    subtitle: sanitizeSubtitle(getSetting<Partial<SubtitleSettings>>('subtitle', {}), DEFAULT_SETTINGS.subtitle),
    autoApprove: getSetting('autoApprove', DEFAULT_SETTINGS.autoApprove),
    simulation: getSetting('simulation', DEFAULT_SETTINGS.simulation),
    simFailEvery: getSetting('simFailEvery', DEFAULT_SETTINGS.simFailEvery),
    apiKeyMasked: key ? maskKey(key) : null,
    roletaUsed: Math.min(ROLETA_TOTAL, getSetting('roletaUsed', 0)),
  };
}

export function patchSettings(patch: SettingsPatch): SettingsDTO {
  if (patch.autoSwitch !== undefined) setSetting('autoSwitch', patch.autoSwitch);
  if (patch.minCredits !== undefined) setSetting('minCredits', patch.minCredits);
  if (patch.parallel !== undefined) {
    if (!(PARALLEL_OPTIONS as readonly number[]).includes(patch.parallel)) throw badRequest('Vídeos simultâneos: escolha de 1 a 4.');
    setSetting('parallel', patch.parallel);
  }
  if (patch.imageModel !== undefined) {
    if (!(IMAGE_MODEL_OPTIONS as readonly string[]).includes(patch.imageModel)) throw badRequest('Modelo de imagem desconhecido.');
    setSetting('imageModel', patch.imageModel);
  }
  if (patch.brain !== undefined) {
    if (!(BRAIN_OPTIONS as readonly string[]).includes(patch.brain)) throw badRequest('Inteligência desconhecida.');
    setSetting('brain', patch.brain);
  }
  if (patch.flowCopy !== undefined) setSetting('flowCopy', patch.flowCopy);
  if (patch.autoApprove !== undefined) setSetting('autoApprove', patch.autoApprove);
  if (patch.simulation !== undefined) setSetting('simulation', patch.simulation);
  if (patch.simFailEvery !== undefined) setSetting('simFailEvery', Math.max(0, Math.min(20, Math.round(patch.simFailEvery))));
  if (patch.subtitle !== undefined) {
    setSetting('subtitle', sanitizeSubtitle(patch.subtitle, getSettings().subtitle));
  }
  return getSettings();
}

/** Chave própria (modo antigo do Diretor): guardada SÓ neste banco; nunca volta inteira para a tela nem sai da máquina. */
export function saveApiKey(key: string): SettingsDTO {
  const k = key.trim();
  if (k.length < 8) throw badRequest('Cole a chave inteira.');
  setSetting('apiKey', k);
  return getSettings();
}
export function removeApiKey(): SettingsDTO {
  deleteSetting('apiKey');
  return getSettings();
}

/** Configuração da simulação lida a cada tick (mudar no ⚙ vale na hora). */
export function getSimConfig(): SimConfig {
  const s = getSettings();
  return { sceneMs: sceneMsFromEnv(), parallel: s.parallel, failEvery: s.simFailEvery };
}
export const isSimulation = (): boolean => getSettings().simulation;

/** "Nunca repete uma combinação sua (N de 80 usadas)": o contador sobe a cada vídeo de um lote roleta. */
export function bumpRoleta(videos: number): void {
  setSetting('roletaUsed', Math.min(ROLETA_TOTAL, getSetting('roletaUsed', 0) + videos));
}

/** "A cor fica salva e vale nos próximos lotes": a última cor escolhida é o padrão das próximas conversas. */
export function getSavedBalloonColor(): string {
  return normalizeHex(getSetting<string>('bubbleColor', DEFAULT_BALLOON_COLOR)) ?? DEFAULT_BALLOON_COLOR;
}

export function saveBalloonColor(hex: string): void {
  const n = normalizeHex(hex);
  if (n) setSetting('bubbleColor', n);
}
