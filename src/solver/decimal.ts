/**
 * 精确十进制数：value = units × 10^(-scale)。
 *
 * 录入的十进制原文（或 number 的最短十进制表示）被精确保留，加、减、乘与比较
 * 均无舍入，用于裁决的安全边界判定：即使整数部分超出双精度表示范围
 * （如质量 2500000000000000.025），真实超限也不会被浮点误差吞没，
 * 而恰好触及边界的录入仍判可行。
 */
export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

/** 十进制零。 */
export const ZERO: Decimal = { units: 0n, scale: 0 };

/** 指数部分的安全上限：拒绝天文级指数，避免构造超大整数。 */
const EXPONENT_LIMIT = 9999;

const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** 去掉末尾的十进制零，保持最简表示（scale 最小，零的符号归一）。 */
function normalize(units: bigint, scale: number): Decimal {
  if (units === 0n) return ZERO;
  let u = units;
  let s = scale;
  while (s > 0 && u % 10n === 0n) {
    u /= 10n;
    s -= 1;
  }
  return { units: u, scale: s };
}

/**
 * 解析十进制原文（可选小数点与指数，如 "2500000000000000.025"、"1e-3"、".5"）。
 * 非法文本或指数超出安全上限时返回 null。
 */
export function parseDecimal(raw: string): Decimal | null {
  const text = raw.trim();
  if (!DECIMAL_PATTERN.test(text)) return null;
  const negative = text.startsWith('-');
  const unsigned = negative || text.startsWith('+') ? text.slice(1) : text;
  const eIndex = unsigned.search(/[eE]/);
  const mantissa = eIndex === -1 ? unsigned : unsigned.slice(0, eIndex);
  const exponent = eIndex === -1 ? 0 : Number(unsigned.slice(eIndex + 1));
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > EXPONENT_LIMIT) return null;
  const dot = mantissa.indexOf('.');
  const intDigits = dot === -1 ? mantissa : mantissa.slice(0, dot);
  const fracDigits = dot === -1 ? '' : mantissa.slice(dot + 1);
  let units = BigInt(intDigits + fracDigits);
  let scale = fracDigits.length - exponent;
  if (negative) units = -units;
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return normalize(units, scale);
}

/**
 * 把录入值（number 或十进制原文）转为精确十进制。
 * number 取其最短十进制表示（String(value)），即录入的十进制值；
 * 非有限数值或非法文本返回 null。
 */
export function decimalOf(value: number | string): Decimal | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return parseDecimal(String(value));
  }
  return parseDecimal(value);
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  const au = a.units * 10n ** BigInt(scale - a.scale);
  const bu = b.units * 10n ** BigInt(scale - b.scale);
  return normalize(au + bu, scale);
}

export function negateDecimal(d: Decimal): Decimal {
  return { units: -d.units, scale: d.scale };
}

export function subDecimal(a: Decimal, b: Decimal): Decimal {
  return addDecimal(a, negateDecimal(b));
}

export function mulDecimal(a: Decimal, b: Decimal): Decimal {
  return normalize(a.units * b.units, a.scale + b.scale);
}

/** 比较：a < b 返回 -1，a = b 返回 0，a > b 返回 1。 */
export function compareDecimal(a: Decimal, b: Decimal): number {
  const sa = a.units === 0n ? 0 : a.units < 0n ? -1 : 1;
  const sb = b.units === 0n ? 0 : b.units < 0n ? -1 : 1;
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (sa === 0) return 0;
  const scale = Math.max(a.scale, b.scale);
  const au = a.units * 10n ** BigInt(scale - a.scale);
  const bu = b.units * 10n ** BigInt(scale - b.scale);
  return au < bu ? -1 : au > bu ? 1 : 0;
}

export function minDecimal(a: Decimal, b: Decimal): Decimal {
  return compareDecimal(a, b) <= 0 ? a : b;
}

/** 转为双精度近似值（仅用于展示与决胜启发式，不参与安全边界判定）。 */
export function decimalToNumber(d: Decimal): number {
  return Number(`${d.units.toString()}e${-d.scale}`);
}
