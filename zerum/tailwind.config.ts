import type { Config } from 'tailwindcss';

/**
 * Tema do Zerum: fundo #0a0a0b, texto branco, Google Sans Text (o app original declara
 * 'Google Sans Text', 'Google Sans', system-ui) e rótulos em monoespaçado maiúsculo.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        zfundo: '#0a0a0b',
        zfundoalt: '#0e0e10',
        ztexto: '#f2f2f2',
      },
      fontFamily: {
        sans: ['"Google Sans Text"', '"Google Sans"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
