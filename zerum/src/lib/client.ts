/** Cliente HTTP do navegador para a API do módulo (todas as rotas ficam sob o basePath /zerum). */
import { BASE_PATH } from './config.shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const res = await fetch(`${BASE_PATH}/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}

export const apiGet = <T>(path: string) => request<T>('GET', path);
export const apiPost = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);
export const apiPatch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
export const apiPut = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
export const apiDelete = <T>(path: string) => request<T>('DELETE', path);
export const apiUpload = <T>(path: string, file: File) => {
  const form = new FormData();
  form.append('file', file, file.name);
  return request<T>('POST', path, undefined, form);
};
