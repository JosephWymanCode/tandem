/**
 * Fractional indexing.
 *
 * Every card and column carries a `pos` string. Items are ordered by comparing
 * those strings, so moving an item only ever rewrites that one item: we pick a
 * new key that sorts between its two new neighbours. Two people moving
 * different cards at the same time therefore never touch the same data.
 *
 * Keys are base-62 fractions ("V" is roughly 0.5). A key never ends in the
 * zero digit, which guarantees there is always room below it.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;

const KEY_PATTERN = /^[0-9A-Za-z]+$/;

export function isValidKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !key.endsWith(ZERO);
}

/** `a` is the lower bound ('' means "start"), `b` the upper bound (null means "end"). */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Shared prefix is kept as is; only the first differing digit matters.
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  }
  // The two first digits are adjacent, so go one digit deeper.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/**
 * Returns a key that sorts strictly between `before` and `after`.
 * Pass null for an open end. If the bounds are equal or reversed (two people
 * inserted at the same spot at the same moment), the key is placed just after
 * `before`; ties between equal keys are broken by id when sorting.
 */
export function keyBetween(before: string | null, after: string | null): string {
  const lower = before ?? '';
  if (after !== null && lower >= after) return midpoint(lower, null);
  return midpoint(lower, after);
}

/** Generates `count` evenly ordered keys, for seeding a fresh list. */
export function initialKeys(count: number): string[] {
  const keys: string[] = [];
  let last: string | null = null;
  for (let i = 0; i < count; i++) {
    last = keyBetween(last, null);
    keys.push(last);
  }
  return keys;
}

/** Sort comparator: by position key, then by id so equal keys order the same everywhere. */
export function byPos(a: { pos: string; id: string }, b: { pos: string; id: string }): number {
  if (a.pos < b.pos) return -1;
  if (a.pos > b.pos) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
