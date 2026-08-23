import { describe, it, expect } from 'vitest';
import { computeTodayStats, startOfToday, actionLabel } from '@/utils/stats';
import { SITE_TEMPLATES, findTemplate } from '@/utils/templates';
import { resetPomodoroDayIfNewDay } from '@/utils/storage';
import { defaultState } from '@/utils/storage';
import type { HistoryEntry } from '@/utils/types';

const entry = (host: string, action: HistoryEntry['action'], at: number): HistoryEntry => ({
  id: Math.random().toString(36),
  at,
  url: `https://${host}/`,
  host,
  label: host,
  action,
});

describe('computeTodayStats', () => {
  const now = new Date(2026, 0, 4, 12, 0).getTime(); // 周日 12:00
  const today9 = new Date(2026, 0, 4, 9, 0).getTime();
  const yesterday = new Date(2026, 0, 3, 23, 0).getTime();
  const history: HistoryEntry[] = [
    entry('youtube.com', 'blocked', today9),
    entry('youtube.com', 'blocked', today9),
    entry('weibo.com', 'keyword', today9),
    entry('x.com', 'silent', yesterday),
  ];
  it('只统计今天', () => {
    const stats = computeTodayStats(history, now);
    expect(stats.totalBlocked).toBe(3);
  });
  it('按方式统计', () => {
    const stats = computeTodayStats(history, now);
    expect(stats.byAction.blocked).toBe(2);
    expect(stats.byAction.keyword).toBe(1);
    expect(stats.byAction.silent).toBeUndefined();
  });
  it('Top 网站', () => {
    const stats = computeTodayStats(history, now);
    expect(stats.topSites[0]).toEqual({ host: 'youtube.com', count: 2 });
  });
  it('startOfToday 为当日零点', () => {
    expect(new Date(startOfToday(now)).getHours()).toBe(0);
  });
  it('actionLabel', () => {
    expect(actionLabel('blocked')).toBe('actionBlocked');
    expect(actionLabel('keyword')).toBe('actionKeyword');
  });
});

describe('templates', () => {
  it('包含常用模板', () => {
    expect(SITE_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(findTemplate('video')?.hosts).toContain('youtube.com');
    expect(findTemplate('nope')).toBeUndefined();
  });
});

describe('resetPomodoroDayIfNewDay', () => {
  it('跨天清零会话计数', () => {
    const s = defaultState();
    s.pomodoro.sessionsCompleted = 5;
    s.pomodoroDay = '2026-01-03';
    const next = resetPomodoroDayIfNewDay(s, new Date(2026, 0, 4, 10, 0).getTime());
    expect(next.pomodoro.sessionsCompleted).toBe(0);
    expect(next.pomodoroDay).toBe('2026-01-04');
  });
  it('同天保持不变', () => {
    const s = defaultState();
    s.pomodoro.sessionsCompleted = 5;
    s.pomodoroDay = '2026-01-04';
    const next = resetPomodoroDayIfNewDay(s, new Date(2026, 0, 4, 10, 0).getTime());
    expect(next.pomodoro.sessionsCompleted).toBe(5);
  });
});
