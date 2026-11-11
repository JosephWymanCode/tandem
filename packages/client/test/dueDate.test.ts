import { describe, expect, it } from 'vitest';
import { daysUntil, dueStatus, formatDueDate, localDateKey } from '../src/board/dueDate';

describe('dueStatus', () => {
  const today = '2026-11-10';

  it('is overdue when the date is before today', () => {
    expect(dueStatus('2026-11-09', today)).toBe('overdue');
    expect(dueStatus('2025-12-31', today)).toBe('overdue');
  });

  it('is due soon today and for the next two days', () => {
    expect(dueStatus('2026-11-10', today)).toBe('soon');
    expect(dueStatus('2026-11-11', today)).toBe('soon');
    expect(dueStatus('2026-11-12', today)).toBe('soon');
  });

  it('is neither after that', () => {
    expect(dueStatus('2026-11-13', today)).toBe('later');
    expect(dueStatus('2027-01-01', today)).toBe('later');
  });

  it('counts days across month, year and daylight saving boundaries', () => {
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
    expect(daysUntil('2026-03-01', '2026-02-28')).toBe(1);
    expect(daysUntil('2026-03-30', '2026-03-28')).toBe(2);
    expect(daysUntil('2026-11-02', '2026-10-31')).toBe(2);
  });
});

describe('date helpers', () => {
  it('reads today from local time', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 10, 14, 0, 1))).toBe('2026-11-14');
  });

  it('formats the stored date without shifting it by a day', () => {
    expect(formatDueDate('2026-11-14', '2026-11-10', 'en-GB')).toBe('14 Nov');
    expect(formatDueDate('2026-01-01', '2026-11-10', 'en-US')).toBe('Jan 1');
    expect(formatDueDate('2027-01-01', '2026-11-10', 'en-US')).toBe('Jan 1, 2027');
  });
});
