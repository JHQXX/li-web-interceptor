/**
 * 时间/时段工具（纯函数，可单测）。
 */

export interface ScheduleLike {
  days: number[];
  startMin: number;
  endMin: number;
  enabled: boolean;
}

/** 一天中的分钟数 */
export function minutesOfDay(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** 星期几，0=周日 */
export function dayOfWeek(date: Date = new Date()): number {
  return date.getDay();
}

/** 判断当前时间是否落在某个允许时段内（支持跨午夜） */
export function isInSchedule(schedules: ScheduleLike[], now: number = Date.now()): boolean {
  const date = new Date(now);
  const mins = minutesOfDay(date);
  const day = dayOfWeek(date);
  for (const s of schedules) {
    if (!s.enabled) continue;
    if (s.days.length > 0 && !s.days.includes(day)) continue;
    if (s.startMin === s.endMin) continue;
    if (s.endMin > s.startMin) {
      if (mins >= s.startMin && mins < s.endMin) return true;
    } else {
      // 跨午夜：22:00 -> 02:00
      if (mins >= s.startMin || mins < s.endMin) return true;
    }
  }
  return false;
}

/** 将毫秒格式化为 mm:ss 或 hh:mm:ss */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 由 "HH:MM" 转为分钟数 */
export function parseClockToMin(value: string): number {
  const parts = value.split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

/** 分钟数转为 "HH:MM" */
export function minToClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
