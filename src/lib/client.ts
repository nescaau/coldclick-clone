'use client';

/** Utilitários de chamadas à API para componentes de cliente. */
import { useEffect, useRef } from 'react';

/** fetch JSON que lança Error com a mensagem em PT-BR devolvida pela API. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `Erro ${res.status}`);
  return body as T;
}

export const jsonInit = (method: string, data?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: data === undefined ? undefined : JSON.stringify(data),
});

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Algo deu errado');

/** Executa `fn` a cada `ms` enquanto `active` for verdadeiro (polling de progresso). */
export function useInterval(fn: () => void, ms: number, active = true) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

/** Lê a duração de um arquivo de vídeo local (antes do upload). Resolve null se o navegador não conseguir. */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 5000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(null);
    };
    video.src = url;
  });
}

/** Upload com progresso (XHR, pois fetch ainda não expõe progresso de envio). */
export function uploadWithProgress<T>(url: string, file: File, onProgress: (percent: number) => void): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: { error?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* resposta não-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new Error(body?.error ?? `Erro ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Falha de rede durante o envio'));
    xhr.onabort = () => reject(new Error('Envio cancelado'));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
