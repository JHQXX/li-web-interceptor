import { browser } from 'wxt/browser';
import { loadState, saveState, updateState, pruneState } from '@/utils/storage';
import { decideHost, expandHost } from '@/utils/rules';
import { getHostname, normalizeHost } from '@/utils/domain';
import { hashPassword, verifyPassword, generatePassword } from '@/utils/crypto';
import { buildSnapshot, serializeSnapshot, parseSnapshot, applySnapshot } from '@/utils/snapshot';
import { uid } from '@/utils/id';
import { PAID_SYNC_ENABLED, getSyncProvider } from '@/sync';
import type { Message } from '@/utils/messaging';
import type { AppState, BlockRule, WhitelistRule, Schedule } from '@/utils/types';

const MENU_BLOCK_PAGE = 'liwi-block-page';
const MENU_BLOCK_LINK = 'liwi-block-link';

function blockedPageUrl(originalUrl: string, host: string): string {
  const params = new URLSearchParams({ url: originalUrl, site: host });
  return `${browser.runtime.getURL('/blocked.html')}?${params.toString()}`;
}

function addBlock(state: AppState, host: string, reason = ''): BlockRule {
  const h = normalizeHost(host);
  const v = state.settings.variants;
  const patterns = expandHost(h, {
    includeSubdomains: v.includeSubdomains,
    includeTldVariants: v.includeTldVariants,
    includeKnownMirrors: v.includeKnownMirrors,
  });
  const existing = state.blockList.find((r) => r.hostname === h);
  if (existing) {
    const updated: BlockRule = {
      ...existing,
      patterns,
      reason: reason || existing.reason,
      options: {
        ...existing.options,
        includeSubdomains: v.includeSubdomains,
        includeVariants: v.includeTldVariants || v.includeKnownMirrors,
      },
    };
    state.blockList = state.blockList.map((r) => (r.id === updated.id ? updated : r));
    return updated;
  }
  const rule: BlockRule = {
    id: uid('br_'),
    hostname: h,
    patterns,
    options: {
      includeSubdomains: v.includeSubdomains,
      includeVariants: v.includeTldVariants || v.includeKnownMirrors,
      countdownMs: state.settings.blockPage.defaultCountdownMs,
    },
    reason,
    createdAt: Date.now(),
  };
  state.blockList.push(rule);
  return rule;
}

function addWhitelist(state: AppState, host: string): WhitelistRule {
  const h = normalizeHost(host);
  const existing = state.whitelist.find((r) => r.hostname === h);
  if (existing) return existing;
  const rule: WhitelistRule = {
    id: uid('wl_'),
    hostname: h,
    patterns: h.startsWith('*.') ? [h] : [h, '*.' + h],
    createdAt: Date.now(),
  };
  state.whitelist.push(rule);
  return rule;
}

async function handleNavigation(details: { tabId: number; frameId: number; url: string }) {
  if (details.frameId !== 0) return;
  if (!/^https?:/i.test(details.url)) return;
  const host = getHostname(details.url);
  if (!host) return;
  const state = await loadState();
  if (!state.settings.lockEnabled) return;
  const decision = decideHost(host, state, Date.now());
  if (decision.status !== 'blocked') return;
  try {
    await browser.tabs.update(details.tabId, { url: blockedPageUrl(details.url, host) });
  } catch {
    // 标签页可能已被关闭，忽略
  }
}

async function setupContextMenus() {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: MENU_BLOCK_PAGE,
    title: '加入网站拦截器',
    contexts: ['page', 'frame'],
  });
  browser.contextMenus.create({
    id: MENU_BLOCK_LINK,
    title: '拦截此链接的网站',
    contexts: ['link'],
  });
}

async function handleContextMenuClick(info: { menuItemId: number | string; pageUrl?: string; linkUrl?: string }) {
  const url = info.menuItemId === MENU_BLOCK_LINK ? info.linkUrl : info.pageUrl;
  if (!url) return;
  const host = getHostname(url);
  if (!host) return;
  await updateState((state) => {
    addBlock(state, host);
    return state;
  });
}

async function handleMessage(message: Message) {
  switch (message.type) {
    case 'get-state': {
      const state = await loadState();
      return { ok: true, state } as const;
    }
    case 'get-tab-info': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? null;
      const host = url ? getHostname(url) : null;
      return { ok: true, url, host } as const;
    }
    case 'add-block': {
      const state = await updateState((s) => { addBlock(s, message.payload.host, message.payload.reason); return s; });
      const rule = state.blockList.find((r) => r.hostname === normalizeHost(message.payload.host));
      return { ok: true, rule: rule! } as const;
    }
    case 'remove-block': {
      await updateState((s) => {
        s.blockList = s.blockList.filter((r) => r.id !== message.payload.id);
        return s;
      });
      return { ok: true } as const;
    }
    case 'update-block': {
      await updateState((s) => {
        s.blockList = s.blockList.map((r) => {
          if (r.id !== message.payload.id) return r;
          const { reason, ...rest } = message.payload.changes;
          r.options = { ...r.options, ...rest };
          if (reason !== undefined) r.reason = reason;
          return r;
        });
        return s;
      });
      return { ok: true } as const;
    }
    case 'add-whitelist': {
      await updateState((s) => { addWhitelist(s, message.payload.host); return s; });
      return { ok: true } as const;
    }
    case 'remove-whitelist': {
      await updateState((s) => {
        s.whitelist = s.whitelist.filter((r) => r.id !== message.payload.id);
        return s;
      });
      return { ok: true } as const;
    }
    case 'set-lock-enabled': {
      await updateState((s) => {
        s.settings.lockEnabled = message.payload.enabled;
        return s;
      });
      return { ok: true } as const;
    }
    case 'set-password-enabled': {
      await updateState((s) => {
        s.settings.password.enabled = message.payload.enabled;
        return s;
      });
      return { ok: true } as const;
    }
    case 'reset-password': {
      const password = generatePassword();
      const { hash, salt } = await hashPassword(password);
      await updateState((s) => {
        s.settings.password = { enabled: true, hash, salt };
        return s;
      });
      return { ok: true, password } as const;
    }
    case 'verify-password': {
      const state = await loadState();
      const p = state.settings.password;
      if (!p.enabled || !p.hash || !p.salt) return { ok: true, valid: false } as const;
      const valid = await verifyPassword(message.payload.password, p.hash, p.salt);
      return { ok: true, valid } as const;
    }
    case 'set-block-page': {
      await updateState((s) => {
        Object.assign(s.settings.blockPage, message.payload);
        return s;
      });
      return { ok: true } as const;
    }
    case 'set-variants': {
      await updateState((s) => {
        s.settings.variants = message.payload.variants;
        return s;
      });
      return { ok: true } as const;
    }
    case 'add-schedule': {
      await updateState((s) => {
        const schedule: Schedule = {
          id: uid('sch_'),
          days: message.payload.days,
          startMin: message.payload.startMin,
          endMin: message.payload.endMin,
          enabled: true,
        };
        s.schedules.push(schedule);
        return s;
      });
      return { ok: true } as const;
    }
    case 'remove-schedule': {
      await updateState((s) => {
        s.schedules = s.schedules.filter((x) => x.id !== message.payload.id);
        return s;
      });
      return { ok: true } as const;
    }
    case 'toggle-schedule': {
      await updateState((s) => {
        s.schedules = s.schedules.map((x) =>
          x.id === message.payload.id ? { ...x, enabled: message.payload.enabled } : x,
        );
        return s;
      });
      return { ok: true } as const;
    }
    case 'start-countdown': {
      await updateState((s) => {
        const host = normalizeHost(message.payload.host);
        const exists = s.blockList.some((r) =>
          r.patterns.some((p) => p === host || p === '*.' + host),
        );
        if (!exists) return s;
        s.activeCountdowns = s.activeCountdowns.filter((c) => c.hostname !== host);
        s.activeCountdowns.push({ id: uid('cd_'), hostname: host, unlocksAt: Date.now() + message.payload.minutes * 60_000 });
        return s;
      });
      return { ok: true } as const;
    }
    case 'session-unlock': {
      await updateState((s) => {
        const host = normalizeHost(message.payload.host);
        s.sessionUnlocks = s.sessionUnlocks.filter((x) => x.hostname !== host);
        s.sessionUnlocks.push({ id: uid('su_'), hostname: host, expiresAt: Date.now() + message.payload.minutes * 60_000 });
        return s;
      });
      return { ok: true } as const;
    }
    case 'remove-countdown': {
      await updateState((s) => {
        s.activeCountdowns = s.activeCountdowns.filter((c) => c.hostname !== message.payload.host);
        return s;
      });
      return { ok: true } as const;
    }
    case 'export-snapshot': {
      const state = await loadState();
      const json = serializeSnapshot(buildSnapshot(state));
      return { ok: true, json } as const;
    }
    case 'import-snapshot': {
      const snap = parseSnapshot(message.payload.json);
      await updateState((s) => applySnapshot(s, snap));
      return { ok: true } as const;
    }
    case 'reset-all': {
      await updateState((s) => {
        s.blockList = [];
        s.whitelist = [];
        s.schedules = [];
        s.sessionUnlocks = [];
        s.activeCountdowns = [];
        return s;
      });
      return { ok: true } as const;
    }
    case 'sync-test': {
      if (!PAID_SYNC_ENABLED) {
        return { ok: false, error: '同步功能尚未开放' } as const;
      }
      const provider = getSyncProvider(message.payload.provider);
      if (!provider) return { ok: false, error: '未知同步提供方' } as const;
      return provider.test({ provider: message.payload.provider });
    }
    default: {
      return { ok: false, error: '未知消息类型' } as unknown as never;
    }
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(handleMessage);
  browser.contextMenus.onClicked.addListener(handleContextMenuClick);
  browser.runtime.onInstalled.addListener(() => {
    setupContextMenus().catch(console.error);
  });
  setupContextMenus().catch(console.error);

  setInterval(async () => {
    const state = await loadState();
    await saveState(pruneState(state));
  }, 5 * 60 * 1000);

  browser.webNavigation.onBeforeNavigate.addListener(handleNavigation);
});
