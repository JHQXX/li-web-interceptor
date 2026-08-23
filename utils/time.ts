/**
 * 时间/时段/番茄钟工具（纯函数，可单测）。
 */
import type { PomodoroState, TimeWindow } from './types';

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

/** 判断某时刻是否落在某个时段窗口内（支持跨午夜；忽略 enabled 字段） */
export function isInWindow(window: TimeWindow, now: number = Date.now()): boolean {
  const date = new Date(now);
  const mins = minutesOfDay(date);
  const day = dayOfWeek(date);
  if (window.days.length > 0 && !window.days.includes(day)) return false;
  if (window.startMin === window.endMin) return false;
  if (window.endMin > window.startMin) {
    return mins >= window.startMin && mins < window.endMin;
  }
  return mins >= window.startMin || mins < window.endMin;
}

/** 判断当前时间是否落在某个允许时段内（兼容旧字段 enabled） */
export function isInSchedule(schedules: ScheduleLike[], now: number = Date.now()): boolean {
  for (const s of schedules) {
    if (!s.enabled) continue;
    if (isInWindow(s, now)) return true;
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

/** 本地日期键 YYYY-MM-DD */
export function dateKey(now: number = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- 番茄钟 ----------

export function pomodoroInitial(): PomodoroState {
  return {
    status: 'idle',
    focusMinutes: 25,
    breakMinutes: 5,
    totalCycles: 1,
    cycleIndex: 0,
    endTime: null,
    pausedRemaining: null,
    pausedFrom: null,
    sessionsCompleted: 0,
  };
}

/** 剩余秒数（-1 表示不存在进行中的计时） */
export function pomodoroRemainingSec(state: PomodoroState, now: number = Date.now()): number {
  if (state.status === 'idle') return -1;
  if (state.status === 'paused') return state.pausedRemaining ?? 0;
  if (state.endTime == null) return 0;
  return Math.max(0, Math.round((state.endTime - now) / 1000));
}

export function pomodoroStart(
  state: PomodoroState,
  focusMinutes: number,
  breakMinutes: number,
  totalCycles: number,
  now: number = Date.now(),
): PomodoroState {
  return {
    ...state,
    status: 'focus',
    focusMinutes: Math.max(1, focusMinutes),
    breakMinutes: Math.max(1, breakMinutes),
    totalCycles: Math.max(1, totalCycles),
    cycleIndex: 0,
    endTime: now + Math.max(1, focusMinutes) * 60_000,
    pausedRemaining: null,
    pausedFrom: null,
  };
}

export function pomodoroPause(state: PomodoroState, now: number = Date.now()): PomodoroState {
  if (state.status !== 'focus' && state.status !== 'break') return state;
  const remaining = state.endTime != null ? Math.max(0, Math.round((state.endTime - now) / 1000)) : 0;
  return {
    ...state,
    status: 'paused',
    pausedRemaining: remaining,
    pausedFrom: state.status === 'break' ? 'break' : 'focus',
    endTime: null,
  };
}

export function pomodoroResume(state: PomodoroState, now: number = Date.now()): PomodoroState {
  if (state.status !== 'paused') return state;
  const remainingMs = (state.pausedRemaining ?? 0) * 1000;
  return {
    ...state,
    status: state.pausedFrom === 'break' ? 'break' : 'focus',
    endTime: now + remainingMs,
    pausedRemaining: null,
    pausedFrom: null,
  };
}

export function pomodoroStop(state: PomodoroState): PomodoroState {
  return {
    ...state,
    status: 'idle',
    endTime: null,
    pausedRemaining: null,
    pausedFrom: null,
    cycleIndex: 0,
  };
}

/** 推进番茄钟：计时结束时的阶段切换（纯函数）。返回变更后的状态与是否变化。 */
export function pomodoroAdvance(
  state: PomodoroState,
  now: number = Date.now(),
): { state: PomodoroState; changed: boolean } {
  if (state.status === 'idle' || state.status === 'paused') return { state, changed: false };
  if (state.endTime == null || now < state.endTime) return { state, changed: false };
  if (state.status === 'focus') {
    return {
      state: { ...state, status: 'break', pausedFrom: null, endTime: now + state.breakMinutes * 60_000, pausedRemaining: null },
      changed: true,
    };
  }
  const nextCycle = state.cycleIndex + 1;
  const sessionsCompleted = state.sessionsCompleted + 1;
  if (nextCycle >= state.totalCycles) {
    return {
      state: { ...state, status: 'idle', cycleIndex: 0, endTime: null, sessionsCompleted },
      changed: true,
    };
  }
  return {
    state: {
      ...state,
      status: 'focus',
      cycleIndex: nextCycle,
      endTime: now + state.focusMinutes * 60_000,
      sessionsCompleted,
      pausedRemaining: null,
      pausedFrom: null,
    },
    changed: true,
  };
}
