import { expect, it } from 'vitest';
import { tomorrow, postponedDate } from '../src/date';
it('uses Japan midnight and crosses year boundaries', () => {
  expect(tomorrow(Date.parse('2026-12-31T14:59:59Z'))).toBe('2027-01-01');
  expect(tomorrow(Date.parse('2026-12-31T15:00:00Z'))).toBe('2027-01-02');
});
it('preserves timed tasks and floating times', () => {
  const now = Date.parse('2026-09-12T03:00:00Z');
  expect(postponedDate('2020-01-01', now)).toBe('2026-09-13');
  expect(postponedDate('2026-09-12T01:30:00Z', now)).toBe('2026-09-13T01:30:00Z');
  expect(postponedDate('2026-09-12T10:30:00', now)).toBe('2026-09-13T10:30:00');
});
