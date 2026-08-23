/**
 * 今日统计（纯函数，可单测）：基于历史记录计算拦截概览。
 */
import type { HistoryEntry, HistoryAction } from './types';

export interface DayStats {
  totalBlocked: number;
  byAction: Partial<Record<HistoryAction, number>>;
  topSites: { host: string; count: number }[];
}

/** 本地当日零点时间戳 */
export function startOfToday(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function computeTodayStats(history: HistoryEntry[], now: number = Date.now()): DayStats {
  const start = startOfToday(now);
  const today = history.filter((h) => h.at >= start);
  const byAction: Partial<Record<HistoryAction, number>> = {};
  const siteCount: Record<string, number> = {};
  for (const h of today) {
    byAction[h.action] = (byAction[h.action] ?? 0) + 1;
    siteCount[h.host] = (siteCount[h.host] ?? 0) + 1;
  }
  const topSites = Object.entries(siteCount)
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    totalBlocked: today.length,
    byAction,
    topSites,
  };
}

export function actionLabel(action: HistoryAction): string {
  const map: Record<HistoryAction, string> = {
    blocked: '拦截页',
    silent: '静默',
    keyword: '关键词',
    allowlist: '全站白名单',
  };
  return map[action] ?? action;
}
