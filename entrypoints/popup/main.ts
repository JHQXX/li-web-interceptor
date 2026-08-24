import './style.css';
import { browser } from 'wxt/browser';
import { send } from '@/utils/messaging';
import { findBlockRule, findWhitelistRule } from '@/utils/rules';
import { getActiveProfile } from '@/utils/storage';
import { formatRemaining, pomodoroRemainingSec } from '@/utils/time';
import { t , applyI18n, applyI18nWhenReady, setLang } from '@/utils/i18n';
import { applyTheme } from '@/utils/theme';

document.documentElement.classList.add('pre-i18n');
import type { AppState, BlockType } from '@/utils/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state: AppState = await send({ type: 'get-state' }).then((r) => r.state);
setLang(state.lang);
applyI18n();
applyI18nWhenReady();
document.documentElement.classList.remove('pre-i18n');
let tabInfo: { url: string | null; host: string | null; tabId?: number } = { url: null, host: null };
let pomoTimer: ReturnType<typeof setInterval> | undefined;

let cleanupTheme: (() => void) | undefined;
function applyThemeSetting() {
  cleanupTheme?.();
  cleanupTheme = applyTheme(state.theme);
  $('btn-theme').textContent = state.theme === 'dark' ? '☀️' : state.theme === 'auto' ? '🌗' : '🌙';
}

async function refresh() {
  const r = await send({ type: 'get-state' });
  state = r.state;
  applyThemeSetting();
  $<HTMLInputElement>('lock-toggle').checked = state.lockEnabled;
  $('block-count').textContent = String(getActiveProfile(state).blockList.length);
  $('block-heading').textContent = t('popupBlockedCount', [getActiveProfile(state).blockList.length]);
  $<HTMLInputElement>('wl-mode-toggle').checked = getActiveProfile(state).settings.whitelistMode;

  // 当前站点
  tabInfo = await send({ type: 'get-tab-info' });
  const host = tabInfo.host;
  if (host) {
    $('current-host').textContent = t('popupCurrentSite', [host]);
    const profile = getActiveProfile(state);
    const url = tabInfo.url ?? `https://${host}`;
    const rule = findBlockRule(url, host, profile.blockList);
    const wl = findWhitelistRule(url, host, profile.whitelist);
    const isWhitelisted = wl?.type === 'permanent';
    $('btn-unblock').classList.toggle('hidden', !rule);
    if (rule) ($('btn-unblock') as HTMLElement).dataset.ruleId = rule.id;
    if (isWhitelisted) {
      $<HTMLButtonElement>('btn-whitelist').disabled = true;
      $<HTMLButtonElement>('btn-whitelist').textContent = t('popupInWhitelist');
    } else {
      $<HTMLButtonElement>('btn-whitelist').disabled = false;
      $<HTMLButtonElement>('btn-whitelist').textContent = t('popupWhitelist');
    }
  } else {
    $('current-host').textContent = t('popupUnknownSite');
    $('btn-unblock').classList.add('hidden');
    $<HTMLButtonElement>('btn-whitelist').disabled = true;
  }

  // 拦截列表
  const ul = $('block-list');
  ul.innerHTML = '';
  const profile = getActiveProfile(state);
  if (profile.blockList.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('popupEmptyBlock');
    ul.appendChild(li);
  } else {
    const TYPE: Record<string, string> = { permanent: t('btypePermanent'), timewise: t('btypeTimewise'), attemptwise: t('btypeAttemptwise'), schedule: t('btypeSchedule') };
    for (const rule of profile.blockList.slice(0, 20)) {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;flex:1;';
      const span = document.createElement('span');
      span.className = 'hostname';
      span.textContent = rule.text;
      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = TYPE[rule.blockType] ?? rule.blockType;
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.textContent = '✕';
      rm.addEventListener('click', async () => {
        await send({ type: 'remove-block', payload: { id: rule.id } });
        refresh();
      });
      left.appendChild(span);
      left.appendChild(type);
      li.appendChild(left);
      li.appendChild(rm);
      ul.appendChild(li);
    }
  }

  renderPause();
  renderPomodoro();
}

function renderPause() {
  const paused = state.pauseUntil != null && state.pauseUntil > Date.now();
  const btn = $<HTMLButtonElement>('btn-pause');
  btn.textContent = paused ? t('popupPaused') : t('popupPause');
  btn.classList.toggle('btn-secondary', paused);
}

function renderPomodoro() {
  const p = state.pomodoro;
  const STATUS: Record<string, string> = { idle: t('popupPomodoro'), focus: t('pomodoroStatusFocus'), break: t('pomodoroStatusBreak'), paused: t('pomodoroStatusPaused') };
  $('pomo-status').textContent = STATUS[p.status] ?? t('popupPomodoro');
  const sec = pomodoroRemainingSec(p);
  $('pomo-time').textContent = sec >= 0 ? formatRemaining(sec * 1000) : `${p.focusMinutes}:00`;
  $('pomo-start').classList.toggle('hidden', p.status !== 'idle');
  $('pomo-pause').classList.toggle('hidden', p.status !== 'focus' && p.status !== 'break');
  $('pomo-resume').classList.toggle('hidden', p.status !== 'paused');
  $('pomo-stop').classList.toggle('hidden', p.status === 'idle');
}

// --- 总开关 / 主题 / 白名单模式 ---
$('lock-toggle').addEventListener('change', async (e) => {
  const enabled = (e.target as HTMLInputElement).checked;
  const res = await send({ type: 'set-lock-enabled', payload: { enabled } });
  if (!res.ok && res.remainingMs != null) {
    $<HTMLInputElement>('lock-toggle').checked = false;
    $('current-host').textContent = t('popupCooldown', [Math.ceil(res.remainingMs / 60000)]);
  }
  refresh();
});
$('btn-theme').addEventListener('click', async () => {
  const order = ['auto', 'light', 'dark'] as const;
  const idx = order.indexOf(state.theme as (typeof order)[number]);
  const next = order[(idx + 1) % order.length] ?? 'auto';
  await send({ type: 'set-theme', payload: { theme: next } });
  refresh();
});
$('wl-mode-toggle').addEventListener('change', async (e) => {
  await send({ type: 'set-whitelist-mode', payload: { enabled: (e.target as HTMLInputElement).checked } });
  refresh();
});

// --- 快速拦截 / 移除 / 白名单 ---
$('btn-block').addEventListener('click', async () => {
  const host = tabInfo.host;
  if (!host || !tabInfo.tabId || !tabInfo.url) return;
  const blockType = ($('block-type') as HTMLSelectElement).value as BlockType;
  const payload = {
    text: host,
    matchMode: 'domain' as const,
    blockType,
    durationMs: blockType === 'timewise' ? 30 * 60_000 : undefined,
    attempts: blockType === 'attemptwise' ? 5 : undefined,
    tabId: tabInfo.tabId,
    url: tabInfo.url,
  };
  await send({ type: 'add-block', payload });
  window.close();
});

$('btn-unblock').addEventListener('click', async () => {
  const id = ($('btn-unblock') as HTMLElement).dataset.ruleId;
  if (id) await send({ type: 'remove-block', payload: { id } });
  refresh();
});

$('btn-whitelist').addEventListener('click', async () => {
  const host = tabInfo.host;
  if (!host) return;
  await send({ type: 'add-whitelist', payload: { text: host, matchMode: 'domain', type: 'permanent' } });
  refresh();
});

// --- 暂停（防打扰） ---
$('btn-pause').addEventListener('click', async () => {
  const paused = state.pauseUntil != null && state.pauseUntil > Date.now();
  await send({ type: 'set-pause', payload: { minutes: paused ? 0 : 10 } });
  refresh();
});

// --- 番茄钟 ---
$('pomo-start').addEventListener('click', async () => {
  const p = state.pomodoro;
  await send({ type: 'pomodoro-start', payload: { focusMinutes: p.focusMinutes, breakMinutes: p.breakMinutes, totalCycles: p.totalCycles } });
  refresh();
});
$('pomo-pause').addEventListener('click', async () => { await send({ type: 'pomodoro-pause' }); refresh(); });
$('pomo-resume').addEventListener('click', async () => { await send({ type: 'pomodoro-resume' }); refresh(); });
$('pomo-stop').addEventListener('click', async () => { await send({ type: 'pomodoro-stop' }); refresh(); });

$('link-options').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

// 每秒刷新番茄时间
pomoTimer = setInterval(async () => {
  const r = await send({ type: 'pomodoro-get' });
  state.pomodoro = r.state;
  renderPomodoro();
}, 1000);

refresh();
