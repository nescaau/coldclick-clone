/** Estado de execução real de um vídeo (videos.real_json): leitura tolerante, ordem das cenas e chave estável. */
import { describe, expect, it } from 'vitest';
import { LEASE_MS, doneCount, leaseHeldBy, newRun, nextScene, parseRun, sceneJobId, sceneOpKey } from './real-run';

describe('real-run', () => {
  it('nasce com todas as cenas na fila; primeira pendente e contagem de prontas em sequência', () => {
    const run = newRun(3);
    expect(run.scenes.map((s) => s.state)).toEqual(['fila', 'fila', 'fila']);
    expect(nextScene(run)).toBe(0);
    expect(doneCount(run)).toBe(0);
    run.scenes[0].state = 'pronto';
    run.scenes[1].state = 'gerando';
    expect(nextScene(run)).toBe(1);
    expect(doneCount(run)).toBe(1);
    run.scenes[1].state = 'pronto';
    run.scenes[2].state = 'pronto';
    expect(nextScene(run)).toBe(-1);
    expect(doneCount(run)).toBe(3);
  });

  it('o que vem depois de uma cena falha não conta como pronto em sequência', () => {
    const run = newRun(3);
    run.scenes[0].state = 'pronto';
    run.scenes[1].state = 'falhou';
    run.scenes[2].state = 'pronto';
    expect(doneCount(run)).toBe(1);
    expect(nextScene(run)).toBe(1);
  });

  it('parseRun tolera lixo/ausência (null) e ajusta o nº de cenas ao do vídeo', () => {
    expect(parseRun('', 3)).toBeNull();
    expect(parseRun('{lixo', 3)).toBeNull();
    expect(parseRun('{"v":2,"scenes":[]}', 3)).toBeNull();
    const a = newRun(2);
    a.scenes[0] = { ...a.scenes[0], state: 'pronto', hash: 'h'.repeat(64), size: 9 };
    const back = parseRun(JSON.stringify(a), 4)!;
    expect(back.scenes).toHaveLength(4);
    expect(back.scenes[0]).toMatchObject({ state: 'pronto', size: 9 });
    expect(back.scenes[3].state).toBe('fila');
    expect(parseRun(JSON.stringify({ ...a, final: { hash: 'f'.repeat(64), size: 1, joined: true } }), 2)!.final).toMatchObject({ joined: true });
  });

  it('chave de operação: estável para o mesmo (vídeo, cena, tentativa, prompt); muda se qualquer um muda', () => {
    const k = sceneOpKey('v1', 0, 0, 'prompt');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(sceneOpKey('v1', 0, 0, 'prompt')).toBe(k);
    expect(new Set([sceneOpKey('v2', 0, 0, 'prompt'), sceneOpKey('v1', 1, 0, 'prompt'), sceneOpKey('v1', 0, 1, 'prompt'), sceneOpKey('v1', 0, 0, 'outro')]).size).toBe(4);
    expect(sceneJobId('v1', 2)).toBe('cena:v1:2');
  });

  it('reserva: vale só para a aba dona e enquanto não expira', () => {
    const run = newRun(1);
    const s = run.scenes[0];
    Object.assign(s, { state: 'gerando', pumpId: 'p1', leaseUntil: 1000 + LEASE_MS });
    expect(leaseHeldBy(s, 'p1', 1000)).toBe(true);
    expect(leaseHeldBy(s, 'p2', 1000)).toBe(false);
    expect(leaseHeldBy(s, 'p1', 1000 + LEASE_MS)).toBe(false);
    s.state = 'fila';
    expect(leaseHeldBy(s, 'p1', 1000)).toBe(false);
  });
});
