import '@fontsource-variable/inter';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ColdClick Affiliates',
  description: 'Estúdio Criativo — réplica local do ColdClick Affiliates',
};

/** Aplica o tema salvo ANTES da primeira pintura (evita piscar claro→escuro). */
const THEME_SCRIPT = `try{var t=localStorage.getItem('cc-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
