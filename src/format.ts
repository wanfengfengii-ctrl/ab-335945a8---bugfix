/** 数值展示：保留至多 3 位小数并去掉多余的 0。 */
export function fmt(x: number | string): string {
  const n = typeof x === 'string' ? Number(x) : x;
  if (!Number.isFinite(n)) return '—';
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
}
