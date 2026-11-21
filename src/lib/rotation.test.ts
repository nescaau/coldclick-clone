import { describe, expect, it } from 'vitest';
import { MODELS, isResolutionAllowed } from './catalog';
import { estimateGenerations } from './estimate';
import {
  accountAvailability,
  isDefinitiveKeyRejection,
  pickAccount,
  pickKey,
  planRotation,
  type RotationAccount,
} from './rotation';

let seq = 0;
const acc = (id: string, over: Partial<RotationAccount> = {}): RotationAccount => ({
  id,
  email: `${id}@example.com`,
  position: ++seq,
  credits: 100,
  enabled: true,
  cycleVideos: 0,
  cycleImages: 0,
  ...over,
});

describe('estimateGenerations', () => {
  it('reproduz o exemplo da referência (20 variações → até 62 gerações)', () => {
    const e = estimateGenerations(20);
    expect(e.maxGenerations).toBe(62);
    expect(e.label).toBe('até 62 gerações: 20 vídeos e 20 imagens-base');
  });

  it('usa o singular para 1 variação', () => {
    expect(estimateGenerations(1).label).toBe('até 5 gerações: 1 vídeo e 1 imagem-base');
  });
});

describe('catálogo', () => {
  it('360p só é permitido no Omni 1.1 Flash', () => {
    expect(isResolutionAllowed('omni-1.1-flash', '360p')).toBe(true);
    expect(isResolutionAllowed('veo-3.1-lite', '360p')).toBe(false);
    expect(isResolutionAllowed('veo-3.1-lite', '720p')).toBe(true);
  });

  it('expõe os modelos na ordem e com os rótulos da referência', () => {
    expect(MODELS.map((m) => m.label)).toEqual([
      'Veo 3.1 - Fast',
      'Veo 3.1 - Fast [Lower Priority]',
      'Veo 3.1 - Lite',
      'Omni 1.1 Flash',
      'Veo 3.1 - Quality',
    ]);
  });
});

describe('accountAvailability', () => {
  it('exige no mínimo 40 créditos', () => {
    expect(accountAvailability(acc('a', { credits: 39 }))).toBe('low_credits');
    expect(accountAvailability(acc('a', { credits: 40 }))).toBe('available');
  });

  it('marca conta fora da rotação e cota esgotada', () => {
    expect(accountAvailability(acc('a', { enabled: false }))).toBe('disabled');
    expect(accountAvailability(acc('a', { cycleVideos: 2, cycleImages: 2 }))).toBe('cycle_exhausted');
  });
});

describe('pickAccount (prioridade)', () => {
  it('usa a primeira conta da ordem enquanto ela tiver cota', () => {
    const a = acc('a', { position: 1 });
    const b = acc('b', { position: 2 });
    expect(pickAccount([b, a], 'video')?.id).toBe('a');
  });

  it('troca para a seguinte quando a primeira esgota a cota do tipo', () => {
    const a = acc('a', { position: 1, cycleVideos: 2 });
    const b = acc('b', { position: 2 });
    expect(pickAccount([a, b], 'video')?.id).toBe('b');
    // a ainda tem cota de imagem
    expect(pickAccount([a, b], 'image')?.id).toBe('a');
  });

  it('ignora contas sem créditos ou fora da rotação', () => {
    const a = acc('a', { position: 1, credits: 10 });
    const b = acc('b', { position: 2, enabled: false });
    const c = acc('c', { position: 3 });
    expect(pickAccount([a, b, c], 'video')?.id).toBe('c');
  });
});

describe('planRotation', () => {
  it('preenche a primeira conta (2 vídeos) antes de passar à seguinte', () => {
    const plan = planRotation([acc('a', { position: 1 }), acc('b', { position: 2 })], 'video', 4);
    expect(plan.steps.map((s) => s.accountId)).toEqual(['a', 'a', 'b', 'b']);
    expect(plan.cyclesAdvanced).toBe(0);
    expect(plan.shortfall).toBe(0);
  });

  it('inicia um novo ciclo quando a cota esgota e há contas com créditos', () => {
    const plan = planRotation([acc('a', { position: 1 }), acc('b', { position: 2 })], 'video', 6);
    expect(plan.cyclesAdvanced).toBe(1);
    expect(plan.finalCycle).toBe(2);
    expect(plan.shortfall).toBe(0);
  });

  it('informa o déficit quando não há nenhuma conta apta', () => {
    const plan = planRotation([acc('a', { credits: 5 })], 'image', 3);
    expect(plan.steps).toHaveLength(0);
    expect(plan.shortfall).toBe(3);
  });

  it('não altera o estado original', () => {
    const accounts = [acc('a')];
    planRotation(accounts, 'video', 2);
    expect(accounts[0].cycleVideos).toBe(0);
  });
});

describe('chaves Gemini (ordem de tentativa)', () => {
  const keys = [
    { id: 'k2', position: 2 },
    { id: 'k1', position: 1 },
    { id: 'k3', position: 3 },
  ];

  it('começa sempre pela primeira da ordem', () => {
    expect(pickKey(keys)?.id).toBe('k1');
    expect(pickKey(keys)?.id).toBe('k1'); // a próxima geração recomeça pela primeira
  });

  it('avança para a próxima somente após rejeições confirmadas nesta geração', () => {
    expect(pickKey(keys, ['k1'])?.id).toBe('k2');
    expect(pickKey(keys, ['k1', 'k2'])?.id).toBe('k3');
    expect(pickKey(keys, ['k1', 'k2', 'k3'])).toBeNull();
    expect(pickKey([], [])).toBeNull();
  });

  it('só autenticação, quota e validação contam como rejeição definitiva', () => {
    for (const s of [400, 401, 403, 429]) expect(isDefinitiveKeyRejection(s)).toBe(true);
    for (const s of [0, 500, 502, 503, 504]) expect(isDefinitiveKeyRejection(s)).toBe(false);
  });
});
