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

import { pomodoroInitial, pomodoroStart, pomodoroPause, pomodoroResume, pomodoroStop, pomodoroAdvance, dateKey } from '@/utils/time';

describe('pomodoro 状态机', () => {
  it('start 进入 focus 并计时', () => {
    const p = pomodoroStart(pomodoroInitial(), 25, 5, 4, 1_000_000);
    expect(p.status).toBe('focus');
    expect(p.endTime).toBe(1_000_000 + 25 * 60_000);
  });
  it('focus 结束进入 break', () => {
    const p = pomodoroStart(pomodoroInitial(), 25, 5, 4, 0);
    const { state: next, changed } = pomodoroAdvance(p, 26 * 60_000);
    expect(changed).toBe(true);
    expect(next.status).toBe('break');
    expect(next.endTime).toBe(26 * 60_000 + 5 * 60_000);
  });
  it('全部轮数结束后进入 idle 并计数', () => {
    const p = { ...pomodoroStart(pomodoroInitial(), 1, 1, 1, 0), sessionsCompleted: 0 };
    // focus 结束 → break
    const step1 = pomodoroAdvance(p, 2 * 60_000);
    expect(step1.changed).toBe(true);
    expect(step1.state.status).toBe('break');
    // break 结束 → 轮数完成 → idle
    const step2 = pomodoroAdvance(step1.state, 3 * 60_000);
    expect(step2.changed).toBe(true);
    expect(step2.state.status).toBe('idle');
    expect(step2.state.sessionsCompleted).toBe(1);
  });
  it('pause/resume 保留剩余时间', () => {
    const p = pomodoroStart(pomodoroInitial(), 25, 5, 1, 0);
    const paused = pomodoroPause(p, 10 * 60_000);
    expect(paused.status).toBe('paused');
    expect(paused.pausedRemaining).toBe(15 * 60);
    const resumed = pomodoroResume(paused, 0);
    expect(resumed.status).toBe('focus');
    expect(resumed.endTime).toBe(15 * 60_000);
  });
  it('stop 归零', () => {
    const p = pomodoroStop(pomodoroStart(pomodoroInitial(), 25, 5, 1, 0));
    expect(p.status).toBe('idle');
    expect(p.endTime).toBeNull();
  });
});

describe('dateKey', () => {
  it('格式 YYYY-MM-DD', () => {
    const d = new Date(2026, 0, 4, 10, 0).getTime();
    expect(dateKey(d)).toBe('2026-01-04');
  });
});
