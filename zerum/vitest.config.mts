import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // `extensao/test/*.test.mjs`: testes da extensão Chrome (JS puro, sem build), que importam também a ponte do app (TS).
  test: { include: ['src/**/*.test.ts', 'extensao/**/*.test.mjs'], environment: 'node' },
});
