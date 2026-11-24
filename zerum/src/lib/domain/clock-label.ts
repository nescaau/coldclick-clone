/**
 * "Até quando?" legível: a pausa por cota dura 24 h, então só "02:12" seria enganoso (parece minutos). Hora local do
 * computador, sem depender de ICU/locale (o resultado é o mesmo no servidor e no navegador).
 *
 *   hoje          → "02:12"
 *   amanhã        → "amanhã 02:12"
 *   mais adiante  → "25/11 02:12"
 */
const two = (n: number): string => String(n).padStart(2, '0');
const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function untilLabel(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const days = Math.round((startOfDay(d) - startOfDay(new Date(now))) / 86_400_000);
  if (days <= 0) return hm;
  if (days === 1) return `amanhã ${hm}`;
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${hm}`;
}
