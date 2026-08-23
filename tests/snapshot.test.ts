import { describe, it, expect } from 'vitest';
import { buildSnapshot, applySnapshot, isSnapshot, serializeSnapshot, parseSnapshot } from '@/utils/snapshot';
import { defaultState } from '@/utils/storage';
import type { AppState } from '@/utils/types';

const state: AppState = defaultState();
state.profiles[0]!.blockList.push({
  id: 'b1', text: 'youtube.com', matchMode: 'domain', blockType: 'permanent', status: 'blocked', reason: '', createdAt: 0,
  patterns: ['youtube.com', '*.youtube.com', 'youtu.be'],
});
state.profiles[0]!.whitelist.push({
  id: 'w1', text: 'mail.google.com', matchMode: 'domain', type: 'permanent', status: 'allowed', createdAt: 0,
});
state.profiles[0]!.keywords.push({ id: 'k1', keyword: '视频', enabled: true });
state.theme = 'dark';

describe('snapshot v2', () => {
  it('build/apply roundtrip 保持档案数据', () => {
    const snap = buildSnapshot(state);
    const restored = applySnapshot(defaultState(), snap);
    expect(restored.profiles[0]!.blockList).toEqual(state.profiles[0]!.blockList);
    expect(restored.profiles[0]!.whitelist).toEqual(state.profiles[0]!.whitelist);
    expect(restored.profiles[0]!.keywords).toEqual(state.profiles[0]!.keywords);
    expect(restored.theme).toBe('dark');
  });
  it('快照不含密码哈希', () => {
    const s2: AppState = { ...state, password: { enabled: true, hash: 'deadbeef', salt: 'salt' } };
    const json = JSON.stringify(buildSnapshot(s2));
    expect(json).not.toContain('deadbeef');
    expect(json).not.toContain('"hash"');
  });
  it('isSnapshot 校验', () => {
    expect(isSnapshot(buildSnapshot(state))).toBe(true);
    expect(isSnapshot({ kind: 'other' })).toBe(false);
    expect(isSnapshot(null)).toBe(false);
  });
  it('serialize/parse roundtrip', () => {
    const json = serializeSnapshot(buildSnapshot(state));
    expect(parseSnapshot(json).data.profiles[0]!.blockList).toHaveLength(1);
  });
  it('非法 JSON 抛错', () => {
    expect(() => parseSnapshot('{bad json')).toThrow();
  });
  it('非快照 JSON 抛错', () => {
    expect(() => parseSnapshot('{"a":1}')).toThrow();
  });
});

import { _migrateForTest } from '@/utils/storage';

describe('v1 → v2 迁移', () => {
  it('迁移旧拦截/白名单/时段到默认档案', () => {
    const v1 = {
      version: 1,
      settings: { lockEnabled: false },
      blockList: [{
        id: 'b1', hostname: 'youtube.com', patterns: ['youtube.com', '*.youtube.com', 'youtu.be'],
        options: { includeSubdomains: true, includeVariants: true, countdownMs: 1800000 }, reason: '', createdAt: 1,
      }],
      whitelist: [{ id: 'w1', hostname: 'mail.google.com', patterns: ['mail.google.com'], createdAt: 1 }],
      schedules: [{ id: 's1', days: [1, 2], startMin: 540, endMin: 1080, enabled: true }],
    };
    const s = _migrateForTest(v1);
    expect(s.version).toBe(2);
    expect(s.lockEnabled).toBe(false);
    const prof = s.profiles[0]!;
    expect(prof.blockList[0]!.matchMode).toBe('domain');
    expect(prof.blockList[0]!.blockType).toBe('permanent');
    expect(prof.blockList[0]!.text).toBe('youtube.com');
    expect(prof.whitelist[0]!.type).toBe('permanent');
    // 旧时段 → 白名单 schedule 条目
    const sch = prof.whitelist.find((w) => w.type === 'schedule');
    expect(sch).toBeDefined();
    expect(sch!.schedule).toEqual({ days: [1, 2], startMin: 540, endMin: 1080 });
  });
});
