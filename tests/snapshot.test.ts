import { describe, it, expect } from 'vitest';
import { buildSnapshot, applySnapshot, isSnapshot, serializeSnapshot, parseSnapshot } from '@/utils/snapshot';
import { defaultState } from '@/utils/storage';  // 未使用浏览器 API，仅结构
import type { AppState } from '@/utils/types';

const state: AppState = defaultState();
state.blockList.push({
  id: 'b1', hostname: 'youtube.com', patterns: ['youtube.com', '*.youtube.com', 'youtu.be'],
  options: { includeSubdomains: true, includeVariants: true, countdownMs: 1800000 }, reason: '', createdAt: 0,
});
state.whitelist.push({ id: 'w1', hostname: 'mail.google.com', patterns: ['mail.google.com'], createdAt: 0 });
state.schedules.push({ id: 's1', days: [1, 2, 3, 4, 5], startMin: 9 * 60, endMin: 18 * 60, enabled: true });

describe('snapshot', () => {
  it('build 与 apply roundtrip 保持核心数据', () => {
    const snap = buildSnapshot(state);
    const restored = applySnapshot(defaultState(), snap);
    expect(restored.blockList).toEqual(state.blockList);
    expect(restored.whitelist).toEqual(state.whitelist);
    expect(restored.schedules).toEqual(state.schedules);
    expect(restored.settings.lockEnabled).toBe(state.settings.lockEnabled);
  });
  it('快照不包含密码哈希', () => {
    const snap = buildSnapshot(state);
    const json = JSON.stringify(snap);
    expect(json).not.toContain('hash');
    expect(json).not.toContain('salt');
  });
  it('isSnapshot 校验', () => {
    expect(isSnapshot(buildSnapshot(state))).toBe(true);
    expect(isSnapshot({ kind: 'other' })).toBe(false);
    expect(isSnapshot(null)).toBe(false);
  });
  it('serialize / parse roundtrip', () => {
    const json = serializeSnapshot(buildSnapshot(state));
    expect(parseSnapshot(json).data.blockList).toHaveLength(1);
  });
  it('非法 JSON 抛错', () => {
    expect(() => parseSnapshot('{bad json')).toThrow();
  });
  it('非快照 JSON 抛错', () => {
    expect(() => parseSnapshot('{"a":1}')).toThrow();
  });
});
