import { describe, it, expect } from 'vitest';
import { isInSchedule, formatRemaining, parseClockToMin, minToClock } from '@/utils/time';

const mkTime = (day: number, h: number, m: number) => {
  const d = new Date(2026, 0, 4); // 周日
  d.setDate(d.getDate() + day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

describe('isInSchedule', () => {
  it('普通时段内放行', () => {
    const s = [{ days: [], startMin: 9 * 60, endMin: 18 * 60, enabled: true }];
    expect(isInSchedule(s, mkTime(0, 12, 0))).toBe(true);
  });
  it('时段外不放行', () => {
    const s = [{ days: [], startMin: 9 * 60, endMin: 18 * 60, enabled: true }];
    expect(isInSchedule(s, mkTime(0, 20, 0))).toBe(false);
  });
  it('跨午夜时段', () => {
    const s = [{ days: [], startMin: 22 * 60, endMin: 2 * 60, enabled: true }];
    expect(isInSchedule(s, mkTime(0, 23, 0))).toBe(true);
    expect(isInSchedule(s, mkTime(1, 1, 0))).toBe(true);
    expect(isInSchedule(s, mkTime(1, 12, 0))).toBe(false);
  });
  it('按星期过滤', () => {
    const s = [{ days: [1], startMin: 0, endMin: 1439, enabled: true }];
    expect(isInSchedule(s, mkTime(1, 12, 0))).toBe(true); // 周一
    expect(isInSchedule(s, mkTime(2, 12, 0))).toBe(false); // 周二
  });
  it('禁用时段不生效', () => {
    const s = [{ days: [], startMin: 0, endMin: 1439, enabled: false }];
    expect(isInSchedule(s, mkTime(0, 12, 0))).toBe(false);
  });
});

describe('time helpers', () => {
  it('formatRemaining', () => {
    expect(formatRemaining(90_000)).toBe('01:30');
    expect(formatRemaining(3_600_000)).toBe('1:00:00');
  });
  it('clock <-> minutes', () => {
    expect(parseClockToMin('09:30')).toBe(570);
    expect(minToClock(570)).toBe('09:30');
  });
});
