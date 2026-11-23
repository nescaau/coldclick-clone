import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // O repositório tem outro package-lock.json na raiz (Estúdio Criativo): fixa a raiz deste app.
  outputFileTracingRoot: path.resolve(process.cwd()),
  // Todas as rotas do módulo (páginas e API) ficam sob /zerum — o app é separado do Estúdio Criativo (porta 3100).
  basePath: '/zerum',
  // better-sqlite3 é um módulo nativo: precisa ficar fora do bundle do servidor.
  serverExternalPackages: ['better-sqlite3'],
  reactStrictMode: true,
  // O middleware (CSRF/Host) faz buffer do corpo das requisições; o padrão (10 MB) truncaria o upload do viral
  // (até 60 MB). Folga acima do limite do app para o multipart.
  experimental: { middlewareClientMaxBodySize: '70mb' },
  async redirects() {
    // Quem abre http://127.0.0.1:3100/ cai direto no estúdio.
    return [{ source: '/', destination: '/zerum', permanent: false, basePath: false }];
  },
};

export default nextConfig;
