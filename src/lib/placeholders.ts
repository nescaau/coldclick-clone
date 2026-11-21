/**
 * Placeholders gerados pelo worker simulado (fase 1).
 * Na fase 2 o arquivo real (imagem/vídeo baixado do Flow) substitui este SVG.
 */
import type { FormatId } from './catalog';
import type { ItemKind } from './types';

const SIZE: Record<FormatId, { w: number; h: number }> = {
  '9:16': { w: 540, h: 960 },
  '1:1': { w: 720, h: 720 },
  '16:9': { w: 960, h: 540 },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface PlaceholderInput {
  kind: ItemKind;
  variation: number;
  format: FormatId;
  avatarName: string;
  model: string;
  resolution: string;
}

export function renderPlaceholderSvg(p: PlaceholderInput): string {
  const { w, h } = SIZE[p.format];
  // Matiz determinística por variação: dá para distinguir os cards na galeria.
  const hue = (p.variation * 47 + (p.kind === 'video' ? 180 : 0)) % 360;
  const label = p.kind === 'video' ? 'Vídeo' : 'Imagem-base';
  const num = String(p.variation).padStart(2, '0');
  const play =
    p.kind === 'video'
      ? `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) * 0.12}" fill="rgba(255,255,255,.22)"/>
         <path d="M${w / 2 - 14} ${h / 2 - 22} L${w / 2 + 24} ${h / 2} L${w / 2 - 14} ${h / 2 + 22} Z" fill="#fff"/>`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 55% 32%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 18%)"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  ${play}
  <g font-family="system-ui, sans-serif" fill="#fff" text-anchor="middle">
    <text x="${w / 2}" y="${h * 0.14}" font-size="${Math.round(w * 0.06)}" font-weight="700">${label} ${num}</text>
    <text x="${w / 2}" y="${h * 0.14 + w * 0.07}" font-size="${Math.round(w * 0.04)}" opacity=".8">${esc(p.avatarName)}</text>
    <text x="${w / 2}" y="${h * 0.93}" font-size="${Math.round(w * 0.032)}" opacity=".65">PLACEHOLDER · ${esc(p.model)} · ${esc(p.resolution)} · ${p.format}</text>
  </g>
</svg>`;
}
