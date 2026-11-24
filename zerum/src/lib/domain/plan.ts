/**
 * Plano do Diretor — regras puras. "O Diretor mostra os passos, você confirma, e a ferramenta executa":
 * o pedido em linguagem natural vira um plano (`requer_confirmacao`) que só vira lote quando o usuário confirma.
 *
 * O Diretor deste clone é LOCAL e determinístico (sem IA): ele reconhece quantidade, caminho (igual/adaptar), variação,
 * idioma, palavra do comentário e "avatares novos" por palavras-chave, e guarda o texto inteiro como observações.
 */
import { MAX_QUANTITY } from '../limits';
import { parseQuantity, type DirectorMode } from './director';
import { LANGUAGES, languageName, sanitizeWord, type LanguageId } from './video-options';

export type PathId = 'igual' | 'adaptar';
export type VariationId = 'sem' | 'roleta' | 'gesto' | 'texto' | 'combinada' | 'novo';

/** Rótulos e descrições literais da aba MANUAL (ref-zerum-manual.snap.txt, passo "2. IGUAL OU ADAPTADO?"). */
export const PATHS: { id: PathId; label: string; badge?: string; desc: string }[] = [
  {
    id: 'igual',
    label: '🎯 Igual ao viral',
    badge: 'padrão',
    desc: 'O mesmo vídeo com outro rosto: fala palavra por palavra, mesmas cenas, ações, lugar, câmera, objetos e legenda.',
  },
  {
    id: 'adaptar',
    label: '🧬 Adaptar (falas novas)',
    desc: 'Mantém a estrutura do viral (gancho, ritmo, cenas, formato, lugar, câmera) e escreve falas novas sobre o mesmo assunto, do jeito que você pedir. Nunca cita marca nem produto.',
  },
];

export const VARIATIONS: { id: VariationId; label: string; desc: string }[] = [
  { id: 'sem', label: 'Sem variação', desc: 'Todos os vídeos iguais entre si; só o avatar muda.' },
  { id: 'roleta', label: '🎰 Método roleta', desc: 'Cada vídeo num cenário, roupa e objeto inéditos pra você; fala e ações iguais.' },
  { id: 'gesto', label: '🤲 Microvariação de gesto', desc: 'Pequenas mudanças de gesto, objeto e cenário. Fala e lógica iguais.' },
  { id: 'texto', label: '✍️ Microvariação de texto', desc: 'Fala com toques pequenos. Estrutura, gestos e cena iguais.' },
  { id: 'combinada', label: '🔀 Combinada', desc: 'Texto, gesto e imagem variam um pouco, tudo junto.' },
  { id: 'novo', label: '✨ Novo a partir do analisado', desc: 'Algo inteiramente novo com a estrutura e a inteligência do viral.' },
];
/** "Nunca repete uma combinação sua (10 de 80 usadas)." */
export const ROLETA_TOTAL = 80;

const stripEmoji = (label: string): string => label.replace(/^\p{Extended_Pictographic}️?\s*/u, '');
export const variationLabel = (id: VariationId): string => stripEmoji(VARIATIONS.find((v) => v.id === id)?.label ?? id);
export const pathLabel = (id: PathId): string => (id === 'igual' ? 'Igual ao viral' : 'Adaptar (falas novas)');

/** Modelo padrão exibido em "PEDIDO" (texto literal do original). */
export const DEFAULT_VIDEO_MODEL = 'Omni 1.1 Flash';
export const IMAGE_MODELS = ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana Lite'] as const;

export interface PlanParams {
  mode: DirectorMode;
  viralId: string | null;
  quantity: number;
  path: PathId;
  variation: VariationId;
  /** Avatares escolhidos da biblioteca (ids). */
  avatarIds: string[];
  /** "🎲 N avatares novos" — rostos novos (sem foto nesta fase). */
  newAvatars: number;
  language: LanguageId;
  word: string;
  batchName: string;
  bubbleOn: boolean;
  bubbleColor: string;
  /** "observações (opcional) — o que você escrever aqui é lei pros roteiros e pras cenas". */
  notes: string;
}

export interface PlanStep {
  id: number;
  texto: string;
  /** O que gasta crédito do Flow vem marcado (só vale quando o executor real existir; na simulação nada é gasto). */
  gastaCredito: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const LANG_WORDS: Record<string, LanguageId> = { ingles: 'en', english: 'en', alemao: 'de', german: 'de', espanhol: 'es', spanish: 'es' };

/** Aplica o pedido em texto livre sobre os parâmetros atuais. Devolve também o que foi entendido (para a resposta). */
export function interpretRequest(text: string, base: PlanParams): { params: PlanParams; entendi: string[] } {
  const t = norm(text);
  const p: PlanParams = { ...base, avatarIds: [...base.avatarIds] };
  const entendi: string[] = [];

  const q = parseQuantity(text);
  if (q !== null) {
    p.quantity = q;
    entendi.push(`${q} vídeo${q === 1 ? '' : 's'}`);
  }

  if (/\b(adapta|adaptar|adaptado|falas? novas?|escreve(?:r)? (?:as )?falas)\b/.test(t)) {
    p.path = 'adaptar';
    entendi.push(pathLabel('adaptar'));
  } else if (/\bigual\b/.test(t)) {
    p.path = 'igual';
    entendi.push(pathLabel('igual'));
  }

  const variationRules: [RegExp, VariationId][] = [
    [/\broleta\b/, 'roleta'],
    [/microvariacao de gesto|varia(?:r)? (?:o )?gesto/, 'gesto'],
    [/microvariacao de texto|varia(?:r)? (?:o )?texto/, 'texto'],
    [/\bcombinada\b/, 'combinada'],
    [/novo a partir do analisado|algo inteiramente novo/, 'novo'],
    [/sem variacao/, 'sem'],
  ];
  for (const [re, id] of variationRules) {
    if (re.test(t)) {
      p.variation = id;
      entendi.push(variationLabel(id));
      break;
    }
  }

  const lang = /\b(ingles|english|alemao|german|espanhol|spanish)\b/.exec(t);
  if (lang && LANGUAGES.some((l) => l.id === LANG_WORDS[lang[1]])) {
    p.language = LANG_WORDS[lang[1]];
    entendi.push(languageName(p.language));
  }

  if (/\b(avatares? novos?|pessoas? novas?|rostos? novos?|new avatars?)\b/.test(t)) {
    p.newAvatars = p.quantity;
    p.avatarIds = [];
    entendi.push('avatares novos');
  }

  // Roda sobre o texto ORIGINAL (com acento, em NFC), então os qualificadores aceitam as duas grafias:
  // "palavra do comentário", "palavra do comentario", "palavra-chave", "palavra no balão"…
  const word =
    /\bpalavra(?:[\s-]+(?:chave|(?:d[oae]s?|n[oa]s?)\s+(?:coment[aá]rios?|bal[aã]o|bal[oõ]es)))?\s*[:=]?\s*["“]?([A-Za-z0-9]{2,24})["”]?/i.exec(
      text.normalize('NFC'),
    );
  if (word) {
    const w = sanitizeWord(word[1]);
    if (w) {
      p.word = w;
      entendi.push(`palavra ${w.toUpperCase()}`);
    }
  }

  // Mudou a quantidade e há "avatares novos": mantém um rosto novo por vídeo.
  if (p.newAvatars > 0) p.newAvatars = p.quantity;
  p.quantity = Math.max(1, Math.min(MAX_QUANTITY, p.quantity));
  const trimmed = text.trim();
  if (trimmed) p.notes = base.notes ? `${base.notes}\n${trimmed}`.slice(-1500) : trimmed.slice(0, 1500);
  return { params: p, entendi };
}

export interface PlanContext {
  viralName: string | null;
  avatarNames: string[];
  batchTitle: string;
}

/** Passos do plano (o Diretor "mostra os passos"). Textos de passo são deste clone (reescritos). */
export function buildSteps(p: PlanParams, c: PlanContext): PlanStep[] {
  const steps: Omit<PlanStep, 'id'>[] = [];
  if (p.mode === 'viral' && c.viralName) steps.push({ texto: `Usar a leitura do viral “${c.viralName}”`, gastaCredito: false });
  if (p.newAvatars > 0) {
    steps.push({ texto: `Criar ${p.newAvatars} avatar${p.newAvatars === 1 ? '' : 'es'} novo${p.newAvatars === 1 ? '' : 's'} (um rosto por vídeo)`, gastaCredito: true });
  } else if (c.avatarNames.length > 0) {
    steps.push({ texto: `Usar ${c.avatarNames.length === 1 ? 'o avatar' : 'os avatares'} ${c.avatarNames.join(', ')}`, gastaCredito: false });
  } else {
    steps.push({ texto: 'Usar os seus avatares salvos', gastaCredito: false });
  }
  steps.push({
    texto: `Escrever ${p.quantity} roteiro${p.quantity === 1 ? '' : 's'} em ${languageName(p.language)} — ${pathLabel(p.path)}${p.variation !== 'sem' ? ` · ${variationLabel(p.variation)}` : ''}`,
    gastaCredito: false,
  });
  steps.push({ texto: `Montar o lote “${c.batchTitle}” (${p.quantity} vídeo${p.quantity === 1 ? '' : 's'})`, gastaCredito: false });
  steps.push({ texto: `Gerar ${p.quantity} vídeo${p.quantity === 1 ? '' : 's'} e abrir a Produção`, gastaCredito: true });
  return steps.map((s, i) => ({ ...s, id: i + 1 }));
}

/** "Executar N passos" / "Executar" (rótulos literais do botão do plano). */
export const executeLabel = (n: number): string => (n === 1 ? 'Executar' : `Executar ${n} passos`);

/** Resumo "PEDIDO ·" do passo 4 da aba MANUAL (literal: "Igual ao viral · sem variação · 3 vídeos · quem aparece? · modelo…"). */
export function pedidoSummary(p: PlanParams, avatarNames: string[], imageModel: string): string {
  const quem = p.newAvatars > 0 ? `${p.newAvatars} avatar${p.newAvatars === 1 ? '' : 'es'} novo${p.newAvatars === 1 ? '' : 's'}` : avatarNames.length ? avatarNames.join(' + ') : 'quem aparece?';
  const v = variationLabel(p.variation).toLowerCase();
  return [pathLabel(p.path), v, `${p.quantity} vídeo${p.quantity === 1 ? '' : 's'}`, quem, DEFAULT_VIDEO_MODEL, `${imageModel} (melhor rosto)`].join(' · ');
}
