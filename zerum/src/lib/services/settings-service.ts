import { getSetting, setSetting } from '../repo/settings';
import { DEFAULT_SETTINGS, type SettingsDTO } from '../types';
import { DEFAULT_BALLOON_COLOR, normalizeHex } from '../domain/video-options';

export function getSettings(): SettingsDTO {
  return {
    autoSwitch: getSetting('autoSwitch', DEFAULT_SETTINGS.autoSwitch),
    minCredits: getSetting('minCredits', DEFAULT_SETTINGS.minCredits),
  };
}

export function patchSettings(patch: Partial<SettingsDTO>): SettingsDTO {
  if (patch.autoSwitch !== undefined) setSetting('autoSwitch', patch.autoSwitch);
  if (patch.minCredits !== undefined) setSetting('minCredits', patch.minCredits);
  return getSettings();
}

/** "A cor fica salva e vale nos próximos lotes": a última cor escolhida é o padrão das próximas conversas. */
export function getSavedBalloonColor(): string {
  return normalizeHex(getSetting<string>('bubbleColor', DEFAULT_BALLOON_COLOR)) ?? DEFAULT_BALLOON_COLOR;
}

export function saveBalloonColor(hex: string): void {
  const n = normalizeHex(hex);
  if (n) setSetting('bubbleColor', n);
}
