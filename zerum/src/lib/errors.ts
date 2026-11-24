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

/** 404 "<coisa> não encontrado/encontrada" — `feminine` ajusta a concordância ("Conversa não encontrada"). */
export const notFound = (what: string, feminine = false) => new AppError(404, `${what} não encontrad${feminine ? 'a' : 'o'}`);
export const conflict = (message: string) => new AppError(409, message);
export const badRequest = (message: string) => new AppError(400, message);
