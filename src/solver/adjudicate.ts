import {
  addDecimal,
  compareDecimal,
  decimalOf,
  decimalToNumber,
  minDecimal,
  mulDecimal,
  subDecimal,
  ZERO,
  type Decimal,
} from './decimal';
import type {
  AdjudicationOutcome,
  Plan,
  Scenario,
  StepRecord,
  Violation,
  ViolationKind,
} from './types';

/** 决胜比较容差：力矩余量与总代价的并列判定使用。 */
export const EPS = 1e-9;

/**
 * 安全边界（总载荷 / 力矩闭区间）判定不使用浮点容差：
 * 质量、力臂与限制均按录入的十进制值精确表示（BigInt 定点），累加与乘法链
 * 无任何舍入，因此恰好触及边界的方案判可行，任何真实超限都判不可行——
 * 包括整数部分超出双精度表示范围的载荷（如 2500000000000000.025，
 * 其小数部分在 Number 中会被舍去，但按录入原文求和的真实超限必须检出）。
 */
interface FlatOption {
  optionIndex: number;
  railId: string;
  railName: string;
  coordinate: number;
  /** 该选项的力矩增量 = 配重质量 × 力臂（精确十进制，与搜索状态无关，预先算好）。 */
  torqueInc: Decimal;
  cost: number;
  costD: Decimal;
}

interface FlatBlock {
  index: number;
  name: string;
  mass: number;
  massD: Decimal;
  options: FlatOption[];
}

/** 按 (块录入序号, 位置录入序号) 沿挂装次序逐位比较，保证稳定决胜。 */
function lexCompareSteps(a: StepRecord[], b: StepRecord[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].blockIndex !== b[i].blockIndex) return a[i].blockIndex - b[i].blockIndex;
    if (a[i].optionIndex !== b[i].optionIndex) return a[i].optionIndex - b[i].optionIndex;
  }
  return a.length - b.length;
}

/**
 * 裁决优先级（依次）：
 * 1. 力矩余量（所有前缀中的最小值）最大者优先；
 * 2. 总安装代价最小者优先；
 * 3. 按挂装顺序的 (块录入序号, 位置录入序号) 序列字典序最小者优先。
 */
function isBetter(a: Plan, b: Plan | null): boolean {
  if (b === null) return true;
  if (a.minTorqueMargin > b.minTorqueMargin + EPS) return true;
  if (a.minTorqueMargin < b.minTorqueMargin - EPS) return false;
  if (a.totalCost < b.totalCost - EPS) return true;
  if (a.totalCost > b.totalCost + EPS) return false;
  return lexCompareSteps(a.steps, b.steps) < 0;
}

/**
 * 裁决：联合确定每块配重恰用一次的挂入位置与完整挂装次序。
 *
 * 搜索按挂装顺序逐步进行，每一个前缀状态都同时校验总载荷与力矩闭区间，
 * 因此绝不出现“先定最终位置再事后排序”的情况；力矩余量沿前缀单调不增、
 * 总代价单调不减（代价非负），据此对当前最优解做分支限界。
 */
export function adjudicate(scenario: Scenario): AdjudicationOutcome {
  const mustDecimal = (value: number | string, label: string): Decimal => {
    const d = decimalOf(value);
    if (d === null) throw new Error(`${label}须为十进制数值`);
    return d;
  };

  const railById = new Map(scenario.rails.map((r) => [r.id, r]));
  const coordinateById = new Map(
    scenario.rails.map((r) => [r.id, mustDecimal(r.coordinate, `导轨「${r.name}」的力臂坐标`)] as const),
  );
  const blocks: FlatBlock[] = scenario.blocks.map((b, i) => {
    const massD = mustDecimal(b.mass, `配重「${b.name}」的质量`);
    return {
      index: i,
      name: b.name,
      mass: decimalToNumber(massD),
      massD,
      options: b.options.map((o, j) => {
        const rail = railById.get(o.railId);
        const coordinateD = coordinateById.get(o.railId);
        if (!rail || !coordinateD) throw new Error(`未知导轨位置: ${o.railId}`);
        const costD = mustDecimal(o.cost, `配重「${b.name}」的安装代价`);
        return {
          optionIndex: j,
          railId: rail.id,
          railName: rail.name,
          coordinate: decimalToNumber(coordinateD),
          torqueInc: mulDecimal(massD, coordinateD),
          cost: decimalToNumber(costD),
          costD,
        };
      }),
    };
  });
  const n = blocks.length;
  const limits = scenario.limits;
  const maxLoadD = mustDecimal(limits.maxLoad, '卷扬轴总载荷上限');
  const minTorqueD = mustDecimal(limits.minTorque, '力矩区间下端');
  const maxTorqueD = mustDecimal(limits.maxTorque, '力矩区间上端');

  const used = new Array<boolean>(n).fill(false);
  const steps: StepRecord[] = [];
  let best: Plan | null = null;
  /** 每个深度上按裁决优先级最优的可行前缀（用于无可行方案时的诊断），附精确十进制状态。 */
  interface PartialEntry {
    plan: Plan;
    massD: Decimal;
    torqueD: Decimal;
  }
  const bestPartial: (PartialEntry | null)[] = new Array(n + 1).fill(null);

  const snapshot = (costD: Decimal, minTorqueMargin: number): Plan => ({
    steps: steps.map((s) => ({ ...s })),
    totalCost: decimalToNumber(costD),
    minTorqueMargin,
    finalMass: steps.length > 0 ? steps[steps.length - 1].cumulativeMass : 0,
    finalTorque: steps.length > 0 ? steps[steps.length - 1].cumulativeTorque : 0,
  });

  const dfs = (depth: number, massD: Decimal, torqueD: Decimal, costD: Decimal, minMargin: number): void => {
    const current = snapshot(costD, minMargin);
    const prev = bestPartial[depth];
    if (isBetter(current, prev ? prev.plan : null)) bestPartial[depth] = { plan: current, massD, torqueD };
    if (depth === n) {
      if (isBetter(current, best)) best = current;
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const block = blocks[i];
      for (const opt of block.options) {
        const massAfter = addDecimal(massD, block.massD);
        if (compareDecimal(massAfter, maxLoadD) > 0) continue; // 总载荷超限
        const torqueAfter = addDecimal(torqueD, opt.torqueInc);
        if (compareDecimal(torqueAfter, minTorqueD) < 0) continue; // 力矩低于下端
        if (compareDecimal(torqueAfter, maxTorqueD) > 0) continue; // 力矩高于上端
        const margin = decimalToNumber(
          minDecimal(subDecimal(torqueAfter, minTorqueD), subDecimal(maxTorqueD, torqueAfter)),
        );
        const nextMinMargin = Math.min(minMargin, margin);
        const nextCostD = addDecimal(costD, opt.costD);
        const nextCost = decimalToNumber(nextCostD);
        if (best) {
          // 力矩余量已严格劣于最优解，剪枝。
          if (nextMinMargin < best.minTorqueMargin - EPS) continue;
          // 余量无法严格更优且代价已严格更差，剪枝。
          if (nextMinMargin < best.minTorqueMargin + EPS && nextCost > best.totalCost + EPS) continue;
        }
        used[i] = true;
        steps.push({
          blockIndex: i,
          blockName: block.name,
          optionIndex: opt.optionIndex,
          railId: opt.railId,
          railName: opt.railName,
          coordinate: opt.coordinate,
          mass: block.mass,
          cost: opt.cost,
          cumulativeMass: decimalToNumber(massAfter),
          cumulativeTorque: decimalToNumber(torqueAfter),
          loadMargin: decimalToNumber(subDecimal(maxLoadD, massAfter)),
          torqueMargin: margin,
        });
        dfs(depth + 1, massAfter, torqueAfter, nextCostD, nextMinMargin);
        steps.pop();
        used[i] = false;
      }
    }
  };

  dfs(0, ZERO, ZERO, ZERO, Number.POSITIVE_INFINITY);

  if (best) return { feasible: true, plan: best };

  // 无可行方案：定位最深的可行已选前缀（其下一步即最早无法继续挂装的位置）。
  let depth = n - 1;
  while (depth >= 0 && bestPartial[depth] === null) depth--;
  const witness = depth >= 0 ? bestPartial[depth] : null;
  const witnessSteps = witness ? witness.plan.steps : [];
  const usedBlocks = new Set(witnessSteps.map((s) => s.blockIndex));
  const baseMassD = witness ? witness.massD : ZERO;
  const baseTorqueD = witness ? witness.torqueD : ZERO;

  const violations: Violation[] = [];
  for (const block of blocks) {
    if (usedBlocks.has(block.index)) continue;
    for (const opt of block.options) {
      const massAfter = addDecimal(baseMassD, block.massD);
      const torqueAfter = addDecimal(baseTorqueD, opt.torqueInc);
      const kinds: ViolationKind[] = [];
      if (compareDecimal(massAfter, maxLoadD) > 0) kinds.push('load');
      if (compareDecimal(torqueAfter, minTorqueD) < 0) kinds.push('torque-low');
      if (compareDecimal(torqueAfter, maxTorqueD) > 0) kinds.push('torque-high');
      if (kinds.length > 0) {
        violations.push({
          blockIndex: block.index,
          blockName: block.name,
          optionIndex: opt.optionIndex,
          railId: opt.railId,
          railName: opt.railName,
          massAfter: decimalToNumber(massAfter),
          torqueAfter: decimalToNumber(torqueAfter),
          kinds,
        });
      }
    }
  }
  return { feasible: false, report: { witnessPrefix: witnessSteps, violations } };
}
