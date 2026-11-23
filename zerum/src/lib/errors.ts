/**
 * Erro de aplicação independente de framework: os serviços lançam `AppError` com o status
 * HTTP semanticamente equivalente; a camada de rotas (lib/http.ts) o converte em resposta JSON.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, `${what} não encontrado`);
export const conflict = (message: string) => new AppError(409, message);
export const badRequest = (message: string) => new AppError(400, message);
