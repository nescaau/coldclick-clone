import type { Config } from 'tailwindcss';

/**
 * Tokens idênticos aos da plataforma de referência (nomes no padrão shadcn/ui).
 * Valores em `globals.css` (variáveis CSS em "R G B" para o Tailwind aplicar opacidade: bg-primary/20).
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        card: token('card'),
        'card-foreground': token('foreground'),
        primary: token('primary'),
        'primary-foreground': token('primary-foreground'),
        secondary: token('secondary'),
        muted: token('muted'),
        'muted-foreground': token('muted-foreground'),
        accent: token('accent'),
        destructive: token('destructive'),
        border: token('border'),
        input: token('border'),
        ring: token('ring'),
        sidebar: token('sidebar'),
        /** Texto/ícones em azul claro (eyebrows, links, item ativo): #93b4ff no tema escuro. */
        link: token('link'),
        /** Painéis aninhados dentro de cartões (um tom acima do card). */
        inset: token('inset'),
        success: token('success'),
        warning: token('warning'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // Escala de raios do shadcn com --radius: 12px (sm 8 · md 10 · lg 12 · xl 16 · 2xl 20 · 3xl 24).
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
        '3xl': 'calc(var(--radius) + 12px)',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.32)',
        /** Brilho do botão primário. */
        primary: '0 6px 16px 0 rgb(var(--primary) / 0.24)',
      },
    },
  },
  plugins: [],
};

export default config;
