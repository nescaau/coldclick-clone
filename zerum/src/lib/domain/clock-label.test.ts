import { describe, expect, it } from 'vitest';
import { untilLabel } from './clock-label';

// Datas locais (o rótulo usa a hora local do computador, então o teste monta as datas no mesmo fuso).
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();

describe('untilLabel (até quando a conta fica em pausa)', () => {
  const now = at(2026, 11, 24, 2, 12);

  it('mais tarde no mesmo dia → só a hora', () => {
    expect(untilLabel(at(2026, 11, 24, 18, 5), now)).toBe('18:05');
    expect(untilLabel(at(2026, 11, 24, 2, 17), now)).toBe('02:17');
  });

  it('a pausa de 24 h cai no dia seguinte → "amanhã HH:mm" (nunca só "02:12", que pareceria minutos)', () => {
    expect(untilLabel(now + 24 * 3600_000, now)).toBe('amanhã 02:12');
    expect(untilLabel(at(2026, 11, 25, 0, 0), at(2026, 11, 24, 23, 59))).toBe('amanhã 00:00');
  });

  it('depois de amanhã ou mais → "dd/MM HH:mm"', () => {
    expect(untilLabel(at(2026, 11, 27, 9, 3), now)).toBe('27/11 09:03');
    expect(untilLabel(at(2027, 1, 2, 23, 45), now)).toBe('02/01 23:45');
  });

  it('horário que já passou (ou agora) → só a hora, sem inventar dia', () => {
    expect(untilLabel(at(2026, 11, 24, 1, 0), now)).toBe('01:00');
    expect(untilLabel(now, now)).toBe('02:12');
  });
});
