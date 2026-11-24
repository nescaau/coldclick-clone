'use client';
import { useState } from 'react';
import { apiPatch, apiPost } from '@/lib/client';
import { ANALYSIS_LIMITS, emptyAnalysis, type Pessoa } from '@/lib/domain/analysis';
import type { ViralDTO } from '@/lib/types';
import { T } from './ui';

interface Props {
  viral: ViralDTO;
  onClose: () => void;
  onSalvo: (v: ViralDTO) => void;
}

const L = 'block pt-2 text-xs font-bold text-white';

/** "✎ Alterar análise": corrige o que a leitura errou (campos e limites do formulário do original). */
export function ViralEditor({ viral, onClose, onSalvo }: Props) {
  const base = viral.analysis ?? emptyAnalysis();
  const [pessoas, setPessoas] = useState<Pessoa[]>(base.pessoas);
  const [rosto, setRosto] = useState(base.rosto);
  const [legenda, setLegenda] = useState(base.legenda);
  const [tela, setTela] = useState(base.tela);
  const [acoes, setAcoes] = useState(base.acoes);
  const [transcricao, setTranscricao] = useState(base.transcricao);
  const [estrutura, setEstrutura] = useState(base.estrutura);
  const [enquadramento, setEnquadramento] = useState(base.enquadramento);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const mudaPessoa = (i: number, p: Partial<Pessoa>) => setPessoas((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const confirmar = async () => {
    setErro('');
    setSalvando(true);
    try {
      onSalvo(await apiPatch<ViralDTO>(`/virals/${viral.id}/analysis`, { pessoas, rosto, legenda, tela, acoes, transcricao, estrutura, enquadramento }));
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
    }
  };

  const voltar = async () => {
    setErro('');
    setSalvando(true);
    try {
      onSalvo(await apiPost<ViralDTO>(`/virals/${viral.id}/analysis/revert`));
    } catch (e) {
      setErro((e as Error).message);
      setSalvando(false);
    }
  };

  return (
    <div role="form" aria-label="Alterar análise" className="space-y-1 rounded-xl border border-white/15 bg-black/40 p-3">
      <p className="text-sm font-black text-white">✎ Alterar análise</p>

      {pessoas.map((p, i) => (
        <div key={i} className="space-y-1 rounded-lg border border-white/10 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={T.rotulo}>pessoa {i + 1}</span>
            <select aria-label={`sexo da pessoa ${i + 1}`} title="sexo" value={p.sexo} disabled={salvando} onChange={(e) => mudaPessoa(i, { sexo: e.target.value as Pessoa['sexo'] })} className={`p-1.5 text-xs ${T.campo} bg-[#0e0e10]`}>
              <option value="">sexo?</option>
              <option value="f">mulher</option>
              <option value="m">homem</option>
            </select>
            <button type="button" title="Só uma pessoa fala no vídeo" disabled={salvando} onClick={() => mudaPessoa(i, { fala: !p.fala })} className={`rounded-full px-2 py-1 text-[11px] font-bold ${p.fala ? T.pillAtiva : 'border border-white/20 text-zinc-300'}`}>
              {p.fala ? 'FALA' : 'não fala'}
            </button>
            <button type="button" title="Tirar esta pessoa" aria-label={`Tirar a pessoa ${i + 1}`} disabled={salvando} onClick={() => setPessoas((l) => l.filter((_, j) => j !== i))} className="material-symbols-outlined text-base text-zinc-400 hover:text-white">
              close
            </button>
          </div>
          <input value={p.descricao} disabled={salvando} maxLength={ANALYSIS_LIMITS.descricao} placeholder="quem é: idade, etnia, CORPO (heavyset / slim), cabelo" onChange={(e) => mudaPessoa(i, { descricao: e.target.value })} className={`w-full p-1.5 text-xs ${T.campo}`} />
          <input value={p.roupa} disabled={salvando} maxLength={ANALYSIS_LIMITS.roupa} placeholder="roupa" onChange={(e) => mudaPessoa(i, { roupa: e.target.value })} className={`w-full p-1.5 text-xs ${T.campo}`} />
        </div>
      ))}
      <button type="button" disabled={salvando || pessoas.length >= ANALYSIS_LIMITS.pessoas} onClick={() => setPessoas((l) => [...l, { sexo: '', fala: false, descricao: '', roupa: '' }])} className={`rounded-full px-3 py-1 text-[11px] ${T.botaoVidro}`}>
        + pessoa que a análise não viu
      </button>

      <div className="flex flex-wrap gap-4 pt-2 text-xs text-white">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={rosto} disabled={salvando} onChange={(e) => setRosto(e.target.checked)} /> o rosto aparece
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={legenda} disabled={salvando} onChange={(e) => setLegenda(e.target.checked)} /> tem legenda na tela
        </label>
      </div>

      <label className={L} htmlFor="ve-tela">
        Lugar, objetos e o que aparece na tela
      </label>
      <textarea id="ve-tela" value={tela} disabled={salvando} rows={3} maxLength={ANALYSIS_LIMITS.tela} onChange={(e) => setTela(e.target.value)} className={`w-full p-2 text-xs ${T.campo}`} />
      <label className={L} htmlFor="ve-acoes">
        Cenas: o que cada pessoa faz em cada uma
      </label>
      <textarea id="ve-acoes" value={acoes} disabled={salvando} rows={3} maxLength={ANALYSIS_LIMITS.acoes} onChange={(e) => setAcoes(e.target.value)} className={`w-full p-2 text-xs ${T.campo}`} />
      <label className={L} htmlFor="ve-fala">
        Fala (transcrição)
      </label>
      <textarea id="ve-fala" value={transcricao} disabled={salvando} rows={3} maxLength={ANALYSIS_LIMITS.transcricao} onChange={(e) => setTranscricao(e.target.value)} className={`w-full p-2 text-xs ${T.campo}`} />
      <label className={L} htmlFor="ve-estrutura">
        Estrutura
      </label>
      <textarea id="ve-estrutura" value={estrutura} disabled={salvando} rows={3} maxLength={ANALYSIS_LIMITS.estrutura} onChange={(e) => setEstrutura(e.target.value)} className={`w-full p-2 text-xs ${T.campo}`} />
      <label className={L} htmlFor="ve-enq">
        Enquadramento
      </label>
      <input id="ve-enq" value={enquadramento} disabled={salvando} maxLength={ANALYSIS_LIMITS.enquadramento} onChange={(e) => setEnquadramento(e.target.value)} className={`w-full p-2 text-xs ${T.campo}`} />

      {erro && (
        <p role="alert" className="text-xs text-zinc-200">
          ⚠ {erro}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-2">
        <button type="button" disabled={salvando} onClick={() => void confirmar()} className={`rounded-xl px-4 py-2 text-sm ${T.botaoPrimario}`}>
          {salvando ? 'Alterando...' : 'Confirmar alteração'}
        </button>
        <button type="button" disabled={salvando} onClick={onClose} className={`rounded-xl px-3 py-2 text-sm ${T.botaoVidro}`}>
          Cancelar
        </button>
        {viral.corrected && (
          <button type="button" disabled={salvando} onClick={() => void voltar()} className={`rounded-xl px-3 py-2 text-sm ${T.botaoVidro}`}>
            voltar à original
          </button>
        )}
      </div>
    </div>
  );
}
