/**
 * "Análise" do viral (o que o Diretor "assistiu"): estrutura, falas, pessoas em cena.
 *
 * HONESTIDADE: não há IA nesta fase. A análise LOCAL só carrega o que o arquivo MP4 realmente diz (duração, dimensões,
 * faixas de vídeo/áudio) e deixa gancho/estrutura/falado VAZIOS. Quem preenche é o usuário em "A leitura errou? Corrigir"
 * (os campos e limites são os do formulário "Alterar análise" do original). A leitura por IA é a fase futura.
 */
import type { Mp4Meta } from './mp4';

export type Sexo = '' | 'f' | 'm';
export interface Pessoa {
  sexo: Sexo;
  /** "Só uma pessoa fala no vídeo": FALA / não fala. */
  fala: boolean;
  descricao: string;
  roupa: string;
}

export interface ViralAnalysis {
  /** 'local' = só metadados do arquivo; 'corrigida' = o usuário editou/confirmou. */
  origem: 'local' | 'corrigida';
  pessoas: Pessoa[];
  rosto: boolean;
  legenda: boolean;
  /** "Lugar, objetos e o que aparece na tela" */
  tela: string;
  /** "Cenas: o que cada pessoa faz em cada uma" */
  acoes: string;
  /** "Fala (transcrição)" */
  transcricao: string;
  estrutura: string;
  enquadramento: string;
}

/** Limites do formulário original ("Alterar análise"). */
export const ANALYSIS_LIMITS = { tela: 2000, acoes: 1200, transcricao: 3000, estrutura: 900, enquadramento: 300, descricao: 300, roupa: 200, pessoas: 4 } as const;

export const emptyAnalysis = (): ViralAnalysis => ({
  origem: 'local',
  pessoas: [],
  rosto: false,
  legenda: false,
  tela: '',
  acoes: '',
  transcricao: '',
  estrutura: '',
  enquadramento: '',
});

/** Análise local: só o que o arquivo informa. O enquadramento vem das dimensões reais, se existirem. */
export function localAnalysis(meta: Mp4Meta | null): ViralAnalysis {
  const a = emptyAnalysis();
  if (meta?.width && meta.height) {
    const o = meta.height > meta.width ? 'vertical' : meta.height < meta.width ? 'horizontal' : 'quadrado';
    a.enquadramento = `${o} ${meta.width}×${meta.height}`;
  }
  return a;
}

/** Parse tolerante do JSON guardado: campo ausente/corrompido volta ao vazio. */
export function readAnalysis(raw: string | null | undefined): ViralAnalysis | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<ViralAnalysis>;
    const base = emptyAnalysis();
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    return {
      origem: p.origem === 'corrigida' ? 'corrigida' : 'local',
      pessoas: Array.isArray(p.pessoas)
        ? p.pessoas.slice(0, ANALYSIS_LIMITS.pessoas).map((x) => ({
            sexo: x?.sexo === 'f' || x?.sexo === 'm' ? x.sexo : '',
            fala: !!x?.fala,
            descricao: str(x?.descricao, ANALYSIS_LIMITS.descricao),
            roupa: str(x?.roupa, ANALYSIS_LIMITS.roupa),
          }))
        : base.pessoas,
      rosto: !!p.rosto,
      legenda: !!p.legenda,
      tela: str(p.tela, ANALYSIS_LIMITS.tela),
      acoes: str(p.acoes, ANALYSIS_LIMITS.acoes),
      transcricao: str(p.transcricao, ANALYSIS_LIMITS.transcricao),
      estrutura: str(p.estrutura, ANALYSIS_LIMITS.estrutura),
      enquadramento: str(p.enquadramento, ANALYSIS_LIMITS.enquadramento),
    };
  } catch {
    return null;
  }
}

/** Gancho = primeira frase da transcrição (até 140 caracteres). Sem transcrição, vazio. */
export function ganchoOf(a: Pick<ViralAnalysis, 'transcricao'>): string {
  const t = a.transcricao.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = /^.*?[.!?](?=\s|$)/.exec(t);
  const first = (m ? m[0] : t).trim();
  return first.length > 140 ? `${first.slice(0, 139).trimEnd()}…` : first;
}

/** Corta em `max` caracteres acrescentando "..." (o original mostra trechos cortados assim). */
export const clip = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}...`;
};

export function fmtDuration(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return '';
  return `${Math.round(s)} s`;
}

/** Marcadores sob o viral: "1 pessoa em cena · fala", "o rosto aparece", "tem legenda na tela" + fatos do arquivo. */
export function analysisBullets(a: ViralAnalysis, meta: { width: number | null; height: number | null; hasAudio: boolean | null }): string[] {
  const out: string[] = [];
  if (a.pessoas.length > 0) {
    const n = a.pessoas.length;
    out.push(`${n} pessoa${n === 1 ? '' : 's'} em cena${a.pessoas.some((p) => p.fala) ? ' · fala' : ''}`);
  }
  if (a.rosto) out.push('o rosto aparece');
  if (a.legenda) out.push('tem legenda na tela');
  if (a.enquadramento) out.push(a.enquadramento);
  if (meta.hasAudio === true) out.push('com áudio');
  else if (meta.hasAudio === false) out.push('sem faixa de áudio');
  return out;
}

/** Roteiro por cena a partir da transcrição: divide em frases e distribui em `n` partes (sem inventar texto). */
export function splitSpeech(transcricao: string, n: number): string[] {
  const sentences = transcricao.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (sentences.length === 0 || n <= 0) return Array.from({ length: Math.max(n, 0) }, () => '');
  const out: string[] = Array.from({ length: n }, () => '');
  sentences.forEach((s, i) => {
    const slot = Math.min(n - 1, Math.floor((i * n) / sentences.length));
    out[slot] = out[slot] ? `${out[slot]} ${s}` : s;
  });
  return out;
}
