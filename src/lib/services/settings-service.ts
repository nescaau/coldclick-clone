/** Configurações do estúdio: padrões, validação e (de)criptografia da chave de transcrição. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_STORAGE_DIR } from '../config';
import { decryptSecret, encryptSecret } from '../crypto';
import { AppError } from '../errors';
import { maskSecret } from '../format';
import { countGeminiKeys } from '../repo/gemini-keys';
import { countActiveJobs } from '../repo/jobs';
import { getRawSetting, setRawSetting } from '../repo/settings';
import { prepareStorageMigration, type StorageMigration } from '../storage-migrate';
import type { PublicSettingsDTO } from '../types';

/** Configuração inválida (HTTP 400). */
export class SettingsError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

const DEFAULTS = {
  whisper_base_url: 'https://api.openai.com/v1',
  whisper_model: 'whisper-1',
  whisper_api_key: '',
  gemini_prompt_model: 'gemini-2.5-flash',
  storage_dir: '',
} as const;

type SettingKey = keyof typeof DEFAULTS;

const read = (key: SettingKey): string => getRawSetting(key) ?? DEFAULTS[key];

/** Aceita "~" no início do caminho (comum no Mac) e resolve para caminho absoluto. */
export function resolveUserPath(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

/** Pasta de armazenamento efetiva (configurada ou padrão). */
export function getStorageDir(): string {
  const configured = read('storage_dir').trim();
  return configured ? resolveUserPath(configured) : DEFAULT_STORAGE_DIR;
}

/** Chave de transcrição em claro — uso exclusivo do servidor. */
function readWhisperKey(): string {
  const stored = read('whisper_api_key');
  return stored ? decryptSecret(stored) : '';
}

export function getWhisperConfig() {
  return {
    baseUrl: read('whisper_base_url').replace(/\/+$/, ''),
    apiKey: readWhisperKey(),
    model: read('whisper_model'),
  };
}

export function getPublicSettings(): PublicSettingsDTO {
  const apiKey = readWhisperKey();
  return {
    whisperBaseUrl: read('whisper_base_url'),
    whisperModel: read('whisper_model'),
    whisperApiKeyMasked: apiKey ? maskSecret(apiKey) : null,
    whisperConfigured: Boolean(apiKey),
    geminiPromptModel: read('gemini_prompt_model'),
    geminiKeysCount: countGeminiKeys(),
    storageDir: getStorageDir(),
    storageDirIsDefault: !read('storage_dir').trim(),
  };
}

/** Valida que a pasta existe (ou pode ser criada) e aceita escrita. */
function assertWritableDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new SettingsError(`Não foi possível usar a pasta "${dir}": ${reason}`);
  }
}

export interface SettingsUpdate {
  whisperBaseUrl?: string;
  whisperModel?: string;
  /** undefined = manter; string vazia = remover. */
  whisperApiKey?: string;
  geminiPromptModel?: string;
  /** string vazia = voltar ao padrão. */
  storageDir?: string;
}

export async function updateSettings(input: SettingsUpdate): Promise<PublicSettingsDTO> {
  // Valida tudo antes de gravar qualquer coisa: a atualização é "tudo ou nada".
  let storageDir: string | undefined;
  let target: string | undefined;
  if (input.storageDir !== undefined) {
    storageDir = input.storageDir.trim();
    target = storageDir ? resolveUserPath(storageDir) : DEFAULT_STORAGE_DIR;
    assertWritableDir(target);
  }
  let baseUrl: string | undefined;
  if (input.whisperBaseUrl !== undefined) {
    baseUrl = input.whisperBaseUrl.trim();
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      throw new SettingsError('A URL base do Whisper deve começar com http:// ou https://');
    }
  }

  // Troca de pasta: os arquivos existentes são COPIADOS e conferidos antes; a pasta antiga só é esvaziada
  // depois que a nova configuração foi gravada (nada fica órfão nem se perde se algo falhar).
  let migration: StorageMigration | undefined;
  if (storageDir !== undefined && target) {
    // Com trabalho em fila/andamento o executor está lendo/gravando arquivos na pasta atual: copiar agora
    // poderia perder um arquivo recém-gravado. Peça ao usuário para esperar ou cancelar.
    if (path.resolve(target) !== path.resolve(getStorageDir()) && countActiveJobs() > 0) {
      throw new AppError(409, 'Não é possível trocar a pasta de armazenamento enquanto houver trabalhos em fila ou em andamento. Aguarde terminar ou cancele-os e tente de novo.');
    }
    migration = await prepareStorageMigration(getStorageDir(), target);
    try {
      setRawSetting('storage_dir', storageDir);
    } catch (e) {
      migration.rollback();
      throw e;
    }
  }
  if (baseUrl !== undefined) setRawSetting('whisper_base_url', baseUrl || DEFAULTS.whisper_base_url);
  if (input.whisperModel !== undefined) setRawSetting('whisper_model', input.whisperModel.trim() || DEFAULTS.whisper_model);
  if (input.whisperApiKey !== undefined) {
    const key = input.whisperApiKey.trim();
    setRawSetting('whisper_api_key', key ? encryptSecret(key) : '');
  }
  if (input.geminiPromptModel !== undefined) {
    setRawSetting('gemini_prompt_model', input.geminiPromptModel.trim() || DEFAULTS.gemini_prompt_model);
  }
  migration?.commit();
  return getPublicSettings();
}

/** Migra uma chave de transcrição antiga (texto puro) para o formato criptografado. */
export function encryptLegacyWhisperKey(): void {
  const stored = read('whisper_api_key');
  if (stored && !stored.startsWith('enc:v1:')) setRawSetting('whisper_api_key', encryptSecret(stored));
}
