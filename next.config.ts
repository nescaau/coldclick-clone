import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 é um módulo nativo: precisa ficar fora do bundle do servidor.
  serverExternalPackages: ['better-sqlite3'],
  reactStrictMode: true,
  async redirects() {
    return [
      // Rotas da fase 1 (Gerador/Configurações) → páginas equivalentes da plataforma de referência.
      { source: '/gerador', destination: '/contas-flow', permanent: false },
    ];
  },
};

export default nextConfig;
