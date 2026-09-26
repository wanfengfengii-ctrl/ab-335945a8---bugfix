import { describe, expect, it } from 'vitest';
import {
  addDecimal,
  compareDecimal,
  decimalOf,
  decimalToNumber,
  mulDecimal,
  parseDecimal,
  subDecimal,
  ZERO,
} from './decimal';

describe('decimal · 解析', () => {
  it('接受常见十进制写法（含指数、省略整数/小数部分、符号与空白）', () => {
    for (const raw of ['1', '-1.5', '+2.', '.5', '1e3', '1E-3', ' 2500000000000000.025 ']) {
      expect(parseDecimal(raw), raw).not.toBeNull();
    }
    expect(compareDecimal(parseDecimal('1e3')!, decimalOf(1000)!)).toBe(0);
    expect(compareDecimal(parseDecimal('.5')!, parseDecimal('0.5')!)).toBe(0);
    expect(compareDecimal(parseDecimal('2.')!, parseDecimal('2')!)).toBe(0);
  });

  it('拒绝非法文本与天文级指数', () => {
    for (const raw of ['', '  ', 'abc', '1.2.3', '1e', '0x10', 'Infinity', 'NaN', '1_000', '1e10000']) {
      expect(parseDecimal(raw), raw).toBeNull();
    }
  });

  it('完整保留超出双精度表示范围的十进制原文', () => {
    // Number('2500000000000000.025') === 2500000000000000，小数部分被舍去；
    // 按原文解析则分毫不少。
    const d = parseDecimal('2500000000000000.025')!;
    expect(decimalToNumber(d)).toBe(2500000000000000); // 转回双精度仍会舍入
    expect(compareDecimal(d, decimalOf(2500000000000000)!)).toBe(1); // 但精确比较能区分
  });

  it('number 取其最短十进制表示', () => {
    expect(compareDecimal(decimalOf(0.1)!, parseDecimal('0.1')!)).toBe(0);
    expect(decimalOf(NaN)).toBeNull();
    expect(decimalOf(Infinity)).toBeNull();
  });
});

describe('decimal · 精确运算', () => {
  it('0.1 + 0.2 精确等于 0.3（无浮点舍入）', () => {
    const sum = addDecimal(decimalOf(0.1)!, decimalOf(0.2)!);
    expect(compareDecimal(sum, decimalOf(0.3)!)).toBe(0);
  });

  it('超大十进制载荷求和：4 × 2500000000000000.025 精确超过 1e16', () => {
    const mass = parseDecimal('2500000000000000.025')!;
    let total = ZERO;
    for (let i = 0; i < 4; i++) total = addDecimal(total, mass);
    // 按录入的十进制值计算，总质量为 10000000000000000.100，超过上限 1e16。
    expect(compareDecimal(total, parseDecimal('10000000000000000')!)).toBe(1);
    expect(compareDecimal(total, parseDecimal('10000000000000000.1')!)).toBe(0);
    // 前三块之和 7500000000000000.075 仍在上限内。
    const three = subDecimal(total, mass);
    expect(compareDecimal(three, parseDecimal('10000000000000000')!)).toBe(-1);
  });

  it('乘法与比较：质量 × 力臂的力矩精确可判', () => {
    const torque = mulDecimal(parseDecimal('2500000000000000.025')!, parseDecimal('0.1')!);
    expect(compareDecimal(torque, parseDecimal('250000000000000.0025')!)).toBe(0);
    expect(compareDecimal(parseDecimal('-0.5')!, parseDecimal('0.5')!)).toBe(-1);
    expect(compareDecimal(ZERO, parseDecimal('-0.000')!)).toBe(0);
  });
});
