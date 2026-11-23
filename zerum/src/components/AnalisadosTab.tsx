'use client';
import { apiDelete } from '@/lib/client';
import type { ViralDTO } from '@/lib/types';
import { T, fmtDateTime, fmtMb } from './ui';

interface Props {
  virais: ViralDTO[];
  onMudou: () => void;
  onUsar: (v: ViralDTO) => void;
}

/** Aba ANALISADOS: virais já enviados (guardados só neste computador). */
export function AnalisadosTab({ virais, onMudou, onUsar }: Props) {
  return (
    <div className={`space-y-4 p-5 ${T.cartao}`}>
      <h2 className={`text-xl ${T.titulo}`}>ANALISADOS</h2>
      {virais.length === 0 ? (
        <p className={`text-sm ${T.textoFraco}`}>Nenhum viral analisado ainda. Coloque um viral no Diretor — ele fica guardado aqui pra usar de novo sem gastar crédito.</p>
      ) : (
        <ul className="space-y-3">
          {virais.map((v) => (
            <li key={v.id} className={`flex flex-wrap items-center gap-3 p-3 ${T.cartaoInterno}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-white">{v.name.replace(/\.mp4$/i, '')}</p>
                <p className={`text-xs ${T.textoFraco}`}>
                  {fmtMb(v.sizeBytes)} · {fmtDateTime(v.createdAt)} · <span className="font-mono uppercase">{v.state}</span>
                </p>
              </div>
              <button type="button" onClick={() => onUsar(v)} className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}>
                usar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Apagar o viral “${v.name}” deste computador?`)) return;
                  await apiDelete(`/virals/${v.id}`);
                  onMudou();
                }}
                className={`rounded-xl px-3 py-1.5 text-xs ${T.botaoVidro}`}
              >
                Apagar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
