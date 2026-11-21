/** Executa uma vez quando o servidor Next sobe: inicializa o app e inicia o worker de trabalhos. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureBootstrapped } = await import('./lib/services/bootstrap');
    const { startWorker } = await import('./lib/worker');
    ensureBootstrapped();
    startWorker();
  }
}
