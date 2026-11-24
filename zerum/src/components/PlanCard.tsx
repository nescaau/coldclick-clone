'use client';
import { executeLabel } from '@/lib/domain/plan';
import type { PlanDTO } from '@/lib/types';
import { T } from './ui';

interface Props {
  plan: PlanDTO;
  ocupado: boolean;
  onConfirmar: (id: string) => void;
  onCancelar: (id: string) => void;
  onAbrirProducao: () => void;
}

/** Cartão "Plano": o Diretor mostra os passos, o usuário confirma, e só então vira lote (requer_confirmacao). */
export function PlanCard({ plan, ocupado, onConfirmar, onCancelar, onAbrirProducao }: Props) {
  const pendente = plan.state === 'pendente';
  return (
    <section aria-label="Plano do Diretor" data-estado={plan.state} className={`mt-3 space-y-2 rounded-xl border p-3 ${pendente ? 'border-white/30 bg-white/[0.06]' : 'border-white/10 bg-black/20 opacity-80'}`}>
      <p className="text-xs text-white">
        <b>Plano</b> <span className={T.textoFraco}>(você confirma; o que gasta crédito está marcado):</span>
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-zinc-100">
        {plan.steps.map((s) => (
          <li key={s.id}>
            {s.texto}
            {s.gastaCredito && <span className="ml-2 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-black text-amber-200">gasta crédito</span>}
          </li>
        ))}
      </ol>
      {pendente ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" disabled={ocupado} onClick={() => onConfirmar(plan.id)} className={`rounded-xl px-4 py-2 text-xs ${T.botaoPrimario}`}>
            {executeLabel(plan.steps.length)}
          </button>
          <button type="button" disabled={ocupado} onClick={() => onCancelar(plan.id)} className={`rounded-xl px-3 py-2 text-xs ${T.botaoVidro}`}>
            Cancelar
          </button>
        </div>
      ) : plan.state === 'executado' ? (
        <p className="text-xs text-zinc-300">
          ✓ executado ·{' '}
          <button type="button" onClick={onAbrirProducao} className={T.link}>
            abrir Produção
          </button>
        </p>
      ) : (
        <p className={`text-xs ${T.textoMudo}`}>{plan.state === 'cancelado' ? 'plano cancelado' : 'substituído por um plano mais novo'}</p>
      )}
    </section>
  );
}
