import { describe, expect, it } from 'vitest';
import { byPos, initialKeys, isValidKey, keyBetween } from '../src/fractional';

describe('keyBetween', () => {
  it('creates a first key', () => {
    expect(isValidKey(keyBetween(null, null))).toBe(true);
  });

  it('sorts between its neighbours', () => {
    const a = keyBetween(null, null);
    const c = keyBetween(a, null);
    const b = keyBetween(a, c);
    expect(a < b && b < c).toBe(true);
    const start = keyBetween(null, a);
    expect(start < a).toBe(true);
  });

  it('always finds room, however often the same gap is split', () => {
    let low = keyBetween(null, null);
    const high = keyBetween(low, null);
    for (let i = 0; i < 200; i++) {
      const mid = keyBetween(low, high);
      expect(low < mid && mid < high).toBe(true);
      expect(isValidKey(mid)).toBe(true);
      low = mid;
    }
  });

  it('keeps finding room at the front', () => {
    let first = keyBetween(null, null);
    for (let i = 0; i < 200; i++) {
      const next = keyBetween(null, first);
      expect(next < first).toBe(true);
      expect(isValidKey(next)).toBe(true);
      first = next;
    }
  });

  it('survives random insertions without ever breaking order', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };
    const keys: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const index = Math.floor(random() * (keys.length + 1));
      const key = keyBetween(keys[index - 1] ?? null, keys[index] ?? null);
      keys.splice(index, 0, key);
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not throw when the bounds are equal', () => {
    const key = keyBetween('V', 'V');
    expect(key > 'V').toBe(true);
  });
});

describe('initialKeys', () => {
  it('returns ascending keys', () => {
    const keys = initialKeys(20);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(20);
  });
});

describe('byPos', () => {
  it('breaks ties by id so every client agrees on the order', () => {
    const items = [
      { id: 'b', pos: 'V' },
      { id: 'a', pos: 'V' },
      { id: 'c', pos: 'A' },
    ];
    expect(items.sort(byPos).map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });
});
