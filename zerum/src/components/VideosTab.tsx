'use client';
import { T } from './ui';

/** Aba VÍDEOS: nesta fase nenhum vídeo é gerado, então só existe o estado vazio local. */
export function VideosTab() {
  return (
    <div className={`space-y-2 p-6 ${T.cartao}`}>
      <h2 className={`text-xl ${T.titulo}`}>VÍDEOS</h2>
      <p className={`text-sm ${T.textoSuave}`}>
        Nenhum vídeo pronto ainda. Quando a geração real (fase futura) terminar um lote, cada vídeo pronto entra aqui.
      </p>
    </div>
  );
}
