import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDiceStacks, stackColumnCount, MAX_DICE_PER_STACK } from '../src/render/diceStacks.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

test('every die gets exactly one placement', () => {
  for (let n = 1; n <= 8; n++) {
    assert.equal(planDiceStacks(n, seededRng(n)).length, n);
  }
});

test('dice fill one column to four before starting the next', () => {
  for (let n = 1; n <= 8; n++) {
    const placements = planDiceStacks(n, seededRng(n));
    const heights = [];
    for (const { column, level } of placements) {
      heights[column] = Math.max(heights[column] ?? 0, level + 1);
    }
    assert.equal(heights.length, stackColumnCount(n));
    assert.equal(heights[0], Math.min(n, MAX_DICE_PER_STACK));
    assert.equal(
      heights.reduce((a, b) => a + b),
      n
    );
    for (const height of heights) assert.ok(height <= MAX_DICE_PER_STACK);
  }
});

test('levels within a column run 0..height-1 with no gaps', () => {
  const placements = planDiceStacks(7, seededRng(3));
  const byColumn = new Map();
  for (const { column, level } of placements) {
    if (!byColumn.has(column)) byColumn.set(column, []);
    byColumn.get(column).push(level);
  }
  for (const levels of byColumn.values()) {
    assert.deepEqual(
      levels.slice().sort((a, b) => a - b),
      levels.map((_, i) => i)
    );
  }
});

test('the die on top of each column shows that column’s height', () => {
  for (let n = 1; n <= 8; n++) {
    const placements = planDiceStacks(n, seededRng(n * 7));
    const tops = new Map();
    for (const p of placements) {
      const current = tops.get(p.column);
      if (!current || p.level > current.level) tops.set(p.column, p);
    }
    let shown = 0;
    for (const top of tops.values()) {
      assert.equal(top.pipUp, top.level + 1, `top of column ${top.column} with ${n} dice`);
      shown += top.pipUp;
    }
    assert.equal(shown, n, 'the stack tops should still add up to the dice count');
  }
});

test('orientations stay on the die: faces 1-6, quarter turns 0-3', () => {
  const rng = seededRng(99);
  for (let n = 1; n <= 8; n++) {
    for (const { pipUp, spin } of planDiceStacks(n, rng)) {
      assert.ok(Number.isInteger(pipUp) && pipUp >= 1 && pipUp <= 6);
      assert.ok(Number.isInteger(spin) && spin >= 0 && spin <= 3);
    }
  }
});

test('dice below the top are tumbled, not all alike', () => {
  const rng = seededRng(5);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    for (const p of planDiceStacks(4, rng)) {
      if (p.level < 3) seen.add(`${p.pipUp}/${p.spin}`);
    }
  }
  assert.ok(seen.size > 6, `expected varied orientations, saw ${seen.size}`);
});
