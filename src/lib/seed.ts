/**
 * Dados de exemplo: 3 avatares com fotos de referência ilustradas (SVG gerado aqui, sem depender
 * de imagens externas). Este arquivo só descreve o CONTEÚDO; quem grava é o avatar-service
 * (`seedAvatarsOnce`), uma única vez — o marcador fica em `settings`, então apagar todos os
 * avatares depois não os recria.
 */

export const SEED_FLAG = 'seeded_avatars_v1';
export const GLOBAL_SEED_FLAG = 'seeded_global_avatars_v1';

/**
 * Avatares da biblioteca global (somente texto, sem fotos). Textos copiados da referência; a voz aparece
 * truncada no snapshot ("…Natural imp..."), então guardamos só até o fim da última frase completa.
 */
export const GLOBAL_AVATARS: Array<{ name: string; description: string; voice: string; gender: 'female' | 'male'; age: number }> = [
  {
    name: 'Dawn',
    description:
      'Native American woman in her early 50s, long straight black hair with silver strands in a single braid, high cheekbones, warm brown skin, plain denim shirt, small turquoise earrings',
    voice:
      'Sounds like a real calm woman sharing family wisdom in a voice note. Native American woman in her early 50s from New Mexico, steady, warm, medium-low pitch, unhurried.',
    gender: 'female',
    age: 53,
  },
];

export interface SeedAvatar {
  name: string;
  description: string;
  voice: string;
  skin: string;
  hair: string;
  top: string;
  bg: [string, string];
}

export const SEED_AVATARS: SeedAvatar[] = [
  {
    name: 'Marina Costa',
    description:
      'Brazilian woman, 32 years old, warm tan skin, long wavy brown hair tied in a high ponytail, athletic build, friendly confident smile. Wearing a light grey sports top and black leggings. Standing in a bright modern home kitchen with white cabinets and soft natural window light.',
    voice:
      'Warm, energetic Brazilian-accented female voice, medium pitch, friendly and motivating, like a fitness coach sharing a tip with a close friend.',
    skin: '#d9a47a',
    hair: '#5a3825',
    top: '#b9bcc4',
    bg: ['#f3e9dc', '#cfe3e8'],
  },
  {
    name: 'Carlos Mendes',
    description:
      'Latino man, 41 years old, short dark hair with light stubble, approachable smile, medium-brown skin. Wearing a navy blazer over a plain white t-shirt. Seated at a tidy home-office desk with a laptop, a plant and a warm desk lamp, shallow depth of field.',
    voice:
      'Confident, calm male voice with a light Latin accent, medium-low pitch, clear and persuasive, speaks like an entrepreneur explaining a smart decision.',
    skin: '#c58c63',
    hair: '#24180f',
    top: '#1f3556',
    bg: ['#2b3447', '#46506a'],
  },
  {
    name: 'Dona Lúcia',
    description:
      'Brazilian woman, 64 years old, short silver hair, gentle wrinkles, round glasses, kind and trustworthy expression, light skin. Wearing a floral cardigan over a cream blouse. Sitting on a cozy living-room sofa with houseplants and soft late-afternoon light coming through the curtains.',
    voice:
      'Soft, gentle grandmotherly voice, slow and warm, slightly raspy, speaks like giving loving advice to her family.',
    skin: '#e8c3a3',
    hair: '#cfd2d8',
    top: '#b86a7a',
    bg: ['#f1dfc9', '#e2b9a0'],
  },
];

/** Retrato estilizado em SVG (cabeça + ombros) em ângulos levemente diferentes. */
export function portraitSvg(a: SeedAvatar, variant: number): string {
  const shift = [0, -14, 14][variant] ?? 0;
  const cx = 300 + shift;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" width="600" height="800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a.bg[0]}"/><stop offset="1" stop-color="${a.bg[1]}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <path d="M${cx - 230} 800 C ${cx - 230} 600 ${cx - 120} 560 ${cx} 560 C ${cx + 120} 560 ${cx + 230} 600 ${cx + 230} 800 Z" fill="${a.top}"/>
  <rect x="${cx - 36}" y="470" width="72" height="110" rx="30" fill="${a.skin}"/>
  <ellipse cx="${cx}" cy="360" rx="120" ry="150" fill="${a.hair}"/>
  <ellipse cx="${cx}" cy="385" rx="100" ry="125" fill="${a.skin}"/>
  <path d="M${cx - 104} 330 C ${cx - 90} 230 ${cx + 90} 230 ${cx + 104} 330 C ${cx + 60} 290 ${cx - 60} 290 ${cx - 104} 330 Z" fill="${a.hair}"/>
  <circle cx="${cx - 38}" cy="385" r="9" fill="#2a2a2a"/><circle cx="${cx + 38}" cy="385" r="9" fill="#2a2a2a"/>
  <path d="M${cx - 34} 440 Q ${cx} 470 ${cx + 34} 440" stroke="#7a3b2e" stroke-width="7" fill="none" stroke-linecap="round"/>
  <text x="300" y="770" text-anchor="middle" font-family="sans-serif" font-size="22" fill="rgba(0,0,0,.35)">referência de exemplo ${variant + 1}</text>
</svg>`;
}
