import { describe, expect, it } from 'vitest';
import { adjudicate } from './solver/adjudicate';
import { defaultDraft, parseDraft, type Draft } from './draft';

describe('parseDraft', () => {
  it('合法草稿解析无误，且数值以十进制原文保留', () => {
    const parsed = parseDraft(defaultDraft());
    expect('errors' in parsed).toBe(false);
    if ('errors' in parsed) return;
    expect(parsed.scenario.blocks[0].mass).toBe('40');
    expect(parsed.scenario.limits.maxLoad).toBe('200');
  });

  it('非数值录入一次性报出错误', () => {
    const draft = defaultDraft();
    draft.blocks[0].mass = 'abc';
    draft.maxLoad = '';
    const parsed = parseDraft(draft);
    expect('errors' in parsed).toBe(true);
    if (!('errors' in parsed)) return;
    expect(parsed.errors.some((e) => e.includes('质量'))).toBe(true);
    expect(parsed.errors.some((e) => e.includes('总载荷上限'))).toBe(true);
  });
});

describe('parseDraft + adjudicate · 超大整数部分十进制载荷草稿', () => {
  // 两条零力臂导轨、总载荷上限 10000000000000000、力矩区间 [0,0]，
  // 4 块质量均为 2500000000000000.025 的配重，每块均可挂任一导轨。
  const hugeDraft = (): Draft => ({
    rails: [
      { id: 'r1', name: 'M1', coordinate: '0' },
      { id: 'r2', name: 'M2', coordinate: '0' },
    ],
    blocks: ['配重甲', '配重乙', '配重丙', '配重丁'].map((name, i) => ({
      id: `b${i}`,
      name,
      mass: '2500000000000000.025',
      options: [
        { railId: 'r1', cost: '1' },
        { railId: 'r2', cost: '1' },
      ],
    })),
    maxLoad: '10000000000000000',
    minTorque: '0',
    maxTorque: '0',
  });

  it('草稿录入的十进制原文完整进入场景（不经 Number 舍入）', () => {
    const parsed = parseDraft(hugeDraft());
    expect('errors' in parsed).toBe(false);
    if ('errors' in parsed) return;
    expect(parsed.scenario.blocks[0].mass).toBe('2500000000000000.025');
    expect(parsed.scenario.limits.maxLoad).toBe('10000000000000000');
  });

  it('总质量 10000000000000000.100 超过上限：判无可行方案，保留三块安全前缀并报告两项载荷超限', () => {
    const parsed = parseDraft(hugeDraft());
    if ('errors' in parsed) throw new Error(`草稿应合法: ${parsed.errors.join('；')}`);
    const outcome = adjudicate(parsed.scenario);
    expect(outcome.feasible).toBe(false);
    if (outcome.feasible) return;
    // 前三块构成安全挂装前缀（已挂 7500000000000000.075 ≤ 上限，力矩恒 0 ∈ [0,0]）。
    expect(outcome.report.witnessPrefix).toHaveLength(3);
    for (const s of outcome.report.witnessPrefix) {
      expect(s.cumulativeTorque).toBe(0);
      expect(s.loadMargin).toBeGreaterThanOrEqual(0);
    }
    // 尝试挂入第 4 块时，两个导轨选择都报告总载荷超限。
    expect(outcome.report.violations).toHaveLength(2);
    expect(outcome.report.violations.map((v) => [v.blockIndex, v.railName])).toEqual([
      [3, 'M1'],
      [3, 'M2'],
    ]);
    for (const v of outcome.report.violations) {
      expect(v.kinds).toEqual(['load']);
      expect(v.torqueAfter).toBe(0);
    }
  });
});
