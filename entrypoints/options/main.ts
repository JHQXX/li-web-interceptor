import './style.css';
import { send } from '@/utils/messaging';
import { getActiveProfile } from '@/utils/storage';
import { minToClock, parseClockToMin, formatRemaining, pomodoroRemainingSec } from '@/utils/time';
import { SECURITY_QUESTIONS } from '@/utils/types';
import { computeTodayStats, actionLabel } from '@/utils/stats';
import { t, weekdayWithPrefix , applyI18n } from '@/utils/i18n';

applyI18n();
import { SITE_TEMPLATES } from '@/utils/templates';
import type { AppState, BlockRule, BlockType, MatchMode, TimeWindow, WhitelistType } from '@/utils/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state: AppState = await send({ type: 'get-state' }).then((r) => r.state);
let pomoTimer: ReturnType<typeof setInterval> | undefined;
let blockQuery = '';
let wlQuery = '';
let historyQuery = '';
let historyFilter = 'all';

const MODE_LABEL: Record<string, string> = { domain: t('matchDomain'), contain: t('matchContain'), exact: t('matchExact'), pattern: t('matchPattern'), full: t('matchFull') };
const BTYPE_LABEL: Record<string, string> = { permanent: t('btypePermanent'), timewise: t('btypeTimewise'), attemptwise: t('btypeAttemptwise'), schedule: t('btypeSchedule') };
const WTYPE_LABEL: Record<string, string> = { permanent: t('wtypePermanent'), attemptwise: t('wtypeAttemptwise'), schedule: t('wtypeSchedule') };

// ---------- Tab 切换 ----------
document.querySelectorAll<HTMLLIElement>('.tabs-nav li').forEach((li) => {
  li.addEventListener('click', () => {
    document.querySelectorAll('.tabs-nav li').forEach((x) => x.classList.remove('tab-active'));
    li.classList.add('tab-active');
    const tab = li.dataset.tab!;
    document.querySelectorAll('.tab-panel').forEach((p) => {
      (p as HTMLElement).classList.toggle('hidden', p.id !== `tab-${tab}`);
    });
  });
});

// ---------- 主题 ----------
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}

function refresh() {
  applyTheme();
  $<HTMLInputElement>('lock-toggle').checked = state.lockEnabled;
  $('profile-badge').textContent = t('profileCurrent', [getActiveProfile(state).name]);
  const profile = getActiveProfile(state);
  const s = profile.settings;
  $<HTMLInputElement>('wl-mode-global').checked = s.whitelistMode;
  $<HTMLInputElement>('silent-mode').checked = s.silentMode;
  $<HTMLInputElement>('kw-enabled').checked = s.keywordBlockingEnabled;
  $<HTMLInputElement>('history-enabled').checked = state.historyEnabled;
  $<HTMLInputElement>('theme-dark').checked = state.theme === 'dark';
  $<HTMLSelectElement>('cooldown-min').value = String(state.cooldownMinutes);
  $<HTMLInputElement>('bp-title').value = s.blockPage.title;
  $<HTMLInputElement>('bp-message').value = s.blockPage.message;
  $<HTMLSelectElement>('bp-type').value = s.blockPage.type;
  $<HTMLInputElement>('bp-redirect').value = s.blockPage.redirectUrl;
  $<HTMLInputElement>('bp-autoclose').value = String(s.blockPage.autoCloseSeconds);
  $<HTMLInputElement>('bp-countdown-toggle').checked = s.blockPage.showCountdown;
  $<HTMLInputElement>('bp-countdown-min').value = String(Math.round(s.blockPage.defaultCountdownMs / 60000));
  $<HTMLInputElement>('v-sub').checked = s.variants.includeSubdomains;
  $<HTMLInputElement>('v-tld').checked = s.variants.includeTldVariants;
  $<HTMLInputElement>('v-mirror').checked = s.variants.includeKnownMirrors;
  // 添加表单的衍生扩展勾选框：默认跟随全局策略（默认全不勾，只拦当前域名）
  $<HTMLInputElement>('bl-sub').checked = s.variants.includeSubdomains;
  $<HTMLInputElement>('bl-tld').checked = s.variants.includeTldVariants;
  $<HTMLInputElement>('bl-mirror').checked = s.variants.includeKnownMirrors;
  $<HTMLInputElement>('pwd-toggle').checked = state.password.enabled;
  renderBlockList();
  renderWhitelist();
  renderKeywords();
  renderHistory();
  renderStats();
  renderProfiles();
  renderPomodoro();
  renderSync();
}

// ---------- 拦截列表 ----------
function renderBlockList() {
  const tbody = $('block-tbody');
  tbody.innerHTML = '';
  const profile = getActiveProfile(state);
  const q = blockQuery.toLowerCase();
  const list = profile.blockList.filter((r) =>
    !q || r.text.toLowerCase().includes(q) || (r.patterns ?? []).some((x) => x.toLowerCase().includes(q)) || (MODE_LABEL[r.matchMode] ?? '').toLowerCase().includes(q) || (BTYPE_LABEL[r.blockType] ?? '').toLowerCase().includes(q),
  );
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${profile.blockList.length === 0 ? t('blEmpty') : t('emptyNoMatch')}</td></tr>`;
    return;
  }
  for (const rule of list) {
    const tr = document.createElement('tr');

    const td1 = document.createElement('td');
    const host = document.createElement('div');
    host.className = 'hostname';
    host.textContent = rule.text;
    td1.appendChild(host);
    if (rule.matchMode === 'domain' && rule.patterns?.length) {
      const p = document.createElement('div');
      p.className = 'patterns';
      p.textContent = rule.patterns.join(', ');
      td1.appendChild(p);
    }

    const td2 = document.createElement('td');
    td2.textContent = MODE_LABEL[rule.matchMode] ?? rule.matchMode;

    const td3 = document.createElement('td');
    td3.textContent = `${BTYPE_LABEL[rule.blockType] ?? rule.blockType}${paramText(rule)}`;

    const td4 = document.createElement('td');
    const sw = document.createElement('label');
    sw.className = 'switch-row';
    sw.style.cssText = 'gap:6px;font-size:12px;';
    sw.innerHTML = `<input type="checkbox" class="mini-check" ${rule.status === 'blocked' ? 'checked' : ''}/> ${rule.status === 'blocked' ? t('statusBlocking') : t('statusPaused')}`;
    const swInput = sw.querySelector('input')!;
    swInput.addEventListener('change', async () => {
      await send({ type: 'set-rule-status', payload: { id: rule.id, status: swInput.checked ? 'blocked' : 'unblocked' } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderBlockList();
    });
    td4.appendChild(sw);

    const td5 = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const redir = document.createElement('input');
    redir.type = 'text';
    redir.className = 'rule-redirect';
    redir.placeholder = t('blRedirectOptional');
    redir.value = rule.redirectUrl ?? '';
    redir.addEventListener('change', async () => {
      await send({ type: 'update-block', payload: { id: rule.id, changes: { redirectUrl: redir.value.trim() || undefined } } });
    });
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.title = t('remove');
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-block', payload: { id: rule.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      refresh();
    });
    wrap.appendChild(redir);
    wrap.appendChild(rm);
    td5.appendChild(wrap);

    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tr.appendChild(td5);
    tbody.appendChild(tr);
  }
}

function paramText(rule: BlockRule): string {
  if (rule.blockType === 'timewise' && rule.durationMs) return ` · ${Math.round(rule.durationMs / 60000)}${t('blMin')}`;
  if (rule.blockType === 'attemptwise') return ` · ${rule.attempts}${t('blTimes')}`;
  if (rule.blockType === 'schedule' && rule.schedule) return scheduleText(rule.schedule);
  return '';
}

function scheduleText(s: TimeWindow): string {
  const days = s.days.length === 0 ? t('everyday') : s.days.map((d) => weekdayWithPrefix(d)).join(' ');
  return ` · ${days} ${minToClock(s.startMin)}-${minToClock(s.endMin)}`;
}

// ---------- 白名单 ----------
function renderWhitelist() {
  const tbody = $('wl-tbody');
  tbody.innerHTML = '';
  const profile = getActiveProfile(state);
  const q = wlQuery.toLowerCase();
  const list = profile.whitelist.filter((r) => !q || r.text.toLowerCase().includes(q) || (r.patterns ?? []).some((x) => x.toLowerCase().includes(q)));
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">${profile.whitelist.length === 0 ? t('wlEmpty') : t('emptyWlNoMatch')}</td></tr>`;
    return;
  }
  for (const rule of list) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    const host = document.createElement('div');
    host.className = 'hostname';
    host.textContent = rule.text;
    td1.appendChild(host);
    const td2 = document.createElement('td');
    td2.textContent = MODE_LABEL[rule.matchMode] ?? rule.matchMode;
    const td3 = document.createElement('td');
    td3.textContent = `${WTYPE_LABEL[rule.type] ?? rule.type}${rule.type === 'attemptwise' ? ` · ${rule.attempts}${t('perDay')}` : ''}${rule.type === 'schedule' && rule.schedule ? scheduleText(rule.schedule) : ''}`;
    const td4 = document.createElement('td');
    const sw = document.createElement('label');
    sw.className = 'switch-row';
    sw.style.cssText = 'gap:6px;font-size:12px;';
    sw.innerHTML = `<input type="checkbox" class="mini-check" ${rule.status === 'allowed' ? 'checked' : ''}/> ${rule.status === 'allowed' ? t('allowed') : t('disabled')}`;
    const swInput = sw.querySelector('input')!;
    swInput.addEventListener('change', async () => {
      await send({ type: 'set-whitelist-status', payload: { id: rule.id, status: swInput.checked ? 'allowed' : 'not-allowed' } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderWhitelist();
    });
    td4.appendChild(sw);
    const td5 = document.createElement('td');
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-whitelist', payload: { id: rule.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      refresh();
    });
    td5.appendChild(rm);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tr.appendChild(td5);
    tbody.appendChild(tr);
  }
}

// ---------- 关键词 ----------
function renderKeywords() {
  const ul = $('kw-list');
  ul.innerHTML = '';
  const profile = getActiveProfile(state);
  if (profile.keywords.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('kwEmpty');
    ul.appendChild(li);
    return;
  }
  for (const k of profile.keywords) {
    const li = document.createElement('li');
    const host = document.createElement('span');
    host.className = 'hostname';
    host.textContent = k.keyword;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const sw = document.createElement('label');
    sw.className = 'switch-row';
    sw.style.cssText = 'gap:6px;font-size:12px;';
    sw.innerHTML = `<input type="checkbox" class="mini-check" ${k.enabled ? 'checked' : ''}/> ${t('enable')}`;
    const swInput = sw.querySelector('input')!;
    swInput.addEventListener('change', async () => {
      await send({ type: 'toggle-keyword', payload: { id: k.id, enabled: swInput.checked } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
    });
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-keyword', payload: { id: k.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderKeywords();
    });
    actions.appendChild(sw);
    actions.appendChild(rm);
    li.appendChild(host);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

// ---------- 历史 ----------
function renderHistory() {
  const tbody = $('history-tbody');
  tbody.innerHTML = '';
  const q = historyQuery.toLowerCase();
  const list = state.history.filter((h) => {
    if (historyFilter !== 'all' && h.action !== historyFilter) return false;
    if (!q) return true;
    return h.host.toLowerCase().includes(q) || h.url.toLowerCase().includes(q) || h.label.toLowerCase().includes(q);
  });
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">' + t('historyNoMatch') + '</td></tr>';
    return;
  }
  for (const h of list.slice(0, 200)) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = new Date(h.at).toLocaleString();
    const td2 = document.createElement('td');
    const host = document.createElement('span');
    host.className = 'hostname';
    host.textContent = h.host;
    td2.appendChild(host);
    const td3 = document.createElement('td');
    td3.textContent = h.label;
    const td4 = document.createElement('td');
    td4.textContent = actionLabel(h.action);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tbody.appendChild(tr);
  }
}

// ---------- 统计 ----------
function renderStats() {
  const stats = computeTodayStats(state.history);
  $('st-total').textContent = String(stats.totalBlocked);
  $('st-blocked').textContent = String(stats.byAction.blocked ?? 0);
  $('st-keyword').textContent = String(stats.byAction.keyword ?? 0);
  $('st-silent').textContent = String(stats.byAction.silent ?? 0);
  $('st-pomo').textContent = String(state.pomodoro.sessionsCompleted);
  const ol = $('st-top');
  ol.innerHTML = '';
  if (stats.topSites.length === 0) {
    ol.innerHTML = '<li class="empty">' + t('statsEmpty') + '</li>';
    return;
  }
  for (const t of stats.topSites) {
    const li = document.createElement('li');
    li.textContent = t.host;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `×${t.count}`;
    li.appendChild(count);
    ol.appendChild(li);
  }
}

// ---------- 档案 ----------
function renderProfiles() {
  const ul = $('profile-list');
  ul.innerHTML = '';
  for (const p of state.profiles) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'hostname';
    name.textContent = p.name;
    left.appendChild(name);
    if (p.id === state.activeProfileId) {
      const badge = document.createElement('span');
      badge.className = 'active-badge';
      badge.textContent = t('profileActive');
      left.appendChild(badge);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    if (p.id !== state.activeProfileId) {
      const use = document.createElement('button');
      use.className = 'btn btn-small';
      use.textContent = t('profileSwitch');
      use.addEventListener('click', async () => {
        await send({ type: 'switch-profile', payload: { id: p.id } });
        state = await send({ type: 'get-state' }).then((r) => r.state);
        refresh();
      });
      actions.appendChild(use);
    }
    const rename = document.createElement('button');
    rename.className = 'btn btn-small btn-ghost';
    rename.textContent = t('profileRename');
    rename.addEventListener('click', async () => {
      const name2 = prompt(t('profileNewName'), p.name);
      if (name2) {
        await send({ type: 'rename-profile', payload: { id: p.id, name: name2 } });
        state = await send({ type: 'get-state' }).then((r) => r.state);
        renderProfiles();
      }
    });
    const del = document.createElement('button');
    del.className = 'btn btn-small btn-danger';
    del.textContent = t('profileDelete');
    del.disabled = state.profiles.length <= 1 || p.id === state.activeProfileId;
    del.addEventListener('click', async () => {
      const res = await send({ type: 'delete-profile', payload: { id: p.id } });
      if (!res.ok) {
        alert(res.error ?? t('saveFailed'));
        return;
      }
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderProfiles();
    });
    actions.appendChild(rename);
    actions.appendChild(del);
    li.appendChild(left);
    li.appendChild(actions);
    ul.appendChild(li);
  }
}

// ---------- 番茄钟 ----------
function renderPomodoro() {
  const p = state.pomodoro;
  const STATUS: Record<string, string> = { idle: t('pomodoroStatusIdle'), focus: t('pomodoroStatusFocus'), break: t('pomodoroStatusBreak'), paused: t('pomodoroStatusPaused') };
  $('pomo-status').textContent = STATUS[p.status] ?? t('pomodoroStatusIdle');
  const sec = pomodoroRemainingSec(p);
  $('pomo-time').textContent = sec >= 0 ? formatRemaining(sec * 1000) : `${p.focusMinutes}:00`;
  $('pomo-sessions').textContent = t('pomodoroSessions', [p.sessionsCompleted]);
  $<HTMLInputElement>('pomo-focus').value = String(p.focusMinutes);
  $<HTMLInputElement>('pomo-break').value = String(p.breakMinutes);
  $<HTMLInputElement>('pomo-cycles').value = String(p.totalCycles);
  $('pomo-start').classList.toggle('hidden', p.status !== 'idle');
  $('pomo-pause').classList.toggle('hidden', p.status !== 'focus' && p.status !== 'break');
  $('pomo-resume').classList.toggle('hidden', p.status !== 'paused');
  $('pomo-stop').classList.toggle('hidden', p.status === 'idle');
}

// ---------- 搜索 / 模板 ----------
$<HTMLInputElement>('block-search').addEventListener('input', (e) => {
  blockQuery = (e.target as HTMLInputElement).value;
  renderBlockList();
});
$<HTMLInputElement>('wl-search').addEventListener('input', (e) => {
  wlQuery = (e.target as HTMLInputElement).value;
  renderWhitelist();
});
$<HTMLInputElement>('history-search').addEventListener('input', (e) => {
  historyQuery = (e.target as HTMLInputElement).value;
  renderHistory();
});
$<HTMLSelectElement>('history-filter').addEventListener('change', (e) => {
  historyFilter = (e.target as HTMLSelectElement).value;
  renderHistory();
});
document.querySelectorAll<HTMLButtonElement>('.tpl').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const tpl = SITE_TEMPLATES.find((t) => t.id === btn.dataset.tpl);
    if (!tpl) return;
    if (!confirm(`${t('blTemplateConfirm')}\n${tpl.hosts.join('\n')}`)) return;
    for (const host of tpl.hosts) {
      await send({ type: 'add-block', payload: { text: host, matchMode: 'domain', blockType: 'permanent' } });
    }
    state = await send({ type: 'get-state' }).then((r) => r.state);
    refresh();
    flashMsg(t('blTemplateAdded', [t(tpl.nameKey)]));
  });
});

// ---------- 添加拦截 ----------
$('btn-add-block').addEventListener('click', async () => {
  const text = $<HTMLInputElement>('bl-text').value.trim();
  if (!text) return;
  const matchMode = $<HTMLSelectElement>('bl-mode').value as MatchMode;
  const blockType = $<HTMLSelectElement>('bl-type').value as BlockType;
  const redirectUrl = $<HTMLInputElement>('bl-redirect').value.trim();
  await send({
    type: 'add-block',
    payload: {
      text,
      matchMode,
      blockType,
      durationMs: blockType === 'timewise' ? Math.max(1, Number($<HTMLInputElement>('bl-minutes').value) || 30) * 60000 : undefined,
      attempts: blockType === 'attemptwise' ? Math.max(1, Number($<HTMLInputElement>('bl-attempts').value) || 5) : undefined,
      schedule: blockType === 'schedule' ? readSchedule('bl-param-schedule') : undefined,
      redirectUrl: redirectUrl || undefined,
      domainOptions: matchMode === 'domain' ? {
        includeSubdomains: $<HTMLInputElement>('bl-sub').checked,
        includeTldVariants: $<HTMLInputElement>('bl-tld').checked,
        includeKnownMirrors: $<HTMLInputElement>('bl-mirror').checked,
      } : undefined,
    },
  });
  $<HTMLInputElement>('bl-text').value = '';
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});
$<HTMLInputElement>('bl-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $<HTMLButtonElement>('btn-add-block').click();
});
$<HTMLSelectElement>('bl-type').addEventListener('change', syncBlockParams);
$<HTMLSelectElement>('bl-mode').addEventListener('change', syncBlockParams);
function syncBlockParams() {
  const t = $<HTMLSelectElement>('bl-type').value;
  const mode = $<HTMLSelectElement>('bl-mode').value;
  $('bl-param-timewise').classList.toggle('hidden', t !== 'timewise');
  $('bl-param-attempt').classList.toggle('hidden', t !== 'attemptwise');
  $('bl-param-schedule').classList.toggle('hidden', t !== 'schedule');
  $('bl-ext').classList.toggle('hidden', mode !== 'domain');
}

// ---------- 添加白名单 ----------
$('btn-add-wl').addEventListener('click', async () => {
  const text = $<HTMLInputElement>('wl-text').value.trim();
  if (!text) return;
  const matchMode = $<HTMLSelectElement>('wl-mode').value as MatchMode;
  const type = $<HTMLSelectElement>('wl-type').value as WhitelistType;
  await send({
    type: 'add-whitelist',
    payload: {
      text,
      matchMode,
      type,
      attempts: type === 'attemptwise' ? Math.max(1, Number($<HTMLInputElement>('wl-attempts').value) || 10) : undefined,
      schedule: type === 'schedule' ? readSchedule('wl-param-schedule') : undefined,
    },
  });
  $<HTMLInputElement>('wl-text').value = '';
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});
$<HTMLSelectElement>('wl-type').addEventListener('change', syncWlParams);
function syncWlParams() {
  const t = $<HTMLSelectElement>('wl-type').value;
  $('wl-param-attempt').classList.toggle('hidden', t !== 'attemptwise');
  $('wl-param-schedule').classList.toggle('hidden', t !== 'schedule');
}

function readSchedule(scopeId: string): TimeWindow {
  const scope = $(scopeId);
  const days = [...scope.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((i) => Number(i.value));
  const startInput = scope.querySelector<HTMLInputElement>('input[type=time]');
  const endInput = scope.querySelectorAll<HTMLInputElement>('input[type=time]')[1];
  return {
    days,
    startMin: parseClockToMin(startInput?.value || '09:00'),
    endMin: parseClockToMin(endInput?.value || '18:00'),
  };
}

// ---------- 关键词 ----------
$('btn-add-kw').addEventListener('click', async () => {
  const kw = $<HTMLInputElement>('kw-input').value.trim();
  if (!kw) return;
  await send({ type: 'add-keyword', payload: { keyword: kw } });
  $<HTMLInputElement>('kw-input').value = '';
  state = await send({ type: 'get-state' }).then((r) => r.state);
  renderKeywords();
});
$('kw-enabled').addEventListener('change', async (e) => {
  await send({ type: 'set-keyword-blocking', payload: { enabled: (e.target as HTMLInputElement).checked } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
});

// ---------- 历史 ----------
$('history-enabled').addEventListener('change', async (e) => {
  await send({ type: 'set-history-enabled', payload: { enabled: (e.target as HTMLInputElement).checked } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
});
$('btn-clear-history').addEventListener('click', async () => {
  await send({ type: 'clear-history' });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  renderHistory();
});

// ---------- 档案 ----------
$('btn-add-profile').addEventListener('click', async () => {
  const name = $<HTMLInputElement>('prof-name').value.trim();
  const inherit = $<HTMLInputElement>('prof-inherit').checked;
  await send({ type: 'create-profile', payload: { name, inherit } });
  $<HTMLInputElement>('prof-name').value = '';
  $<HTMLInputElement>('prof-inherit').checked = false;
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});

// ---------- 番茄钟 ----------
$('pomo-start').addEventListener('click', async () => {
  await send({
    type: 'pomodoro-start',
    payload: {
      focusMinutes: Number($<HTMLInputElement>('pomo-focus').value) || 25,
      breakMinutes: Number($<HTMLInputElement>('pomo-break').value) || 5,
      totalCycles: Number($<HTMLInputElement>('pomo-cycles').value) || 1,
    },
  });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  renderPomodoro();
});
$('pomo-pause').addEventListener('click', async () => { await send({ type: 'pomodoro-pause' }); state = await send({ type: 'get-state' }).then((r) => r.state); renderPomodoro(); });
$('pomo-resume').addEventListener('click', async () => { await send({ type: 'pomodoro-resume' }); state = await send({ type: 'get-state' }).then((r) => r.state); renderPomodoro(); });
$('pomo-stop').addEventListener('click', async () => { await send({ type: 'pomodoro-stop' }); state = await send({ type: 'get-state' }).then((r) => r.state); renderPomodoro(); });

// ---------- 总开关 / 全局行为 ----------
$('lock-toggle').addEventListener('change', async (e) => {
  const enabled = (e.target as HTMLInputElement).checked;
  const res = await send({ type: 'set-lock-enabled', payload: { enabled } });
  if (!res.ok) {
    $<HTMLInputElement>('lock-toggle').checked = false;
    alert(t('cooling', [Math.ceil((res.remainingMs ?? 0) / 60000)]));
  }
  state = await send({ type: 'get-state' }).then((r) => r.state);
});
$('wl-mode-global').addEventListener('change', async (e) => {
  await send({ type: 'set-whitelist-mode', payload: { enabled: (e.target as HTMLInputElement).checked } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
});
$('silent-mode').addEventListener('change', async (e) => {
  await send({ type: 'set-silent-mode', payload: { enabled: (e.target as HTMLInputElement).checked } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
});
$('theme-dark').addEventListener('change', async (e) => {
  await send({ type: 'set-theme', payload: { theme: (e.target as HTMLInputElement).checked ? 'dark' : 'light' } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});
$('cooldown-min').addEventListener('change', async () => {
  await send({ type: 'set-cooldown', payload: { minutes: Number($<HTMLSelectElement>('cooldown-min').value) } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
});

// ---------- 拦截页 / 衍生策略 ----------
$('btn-save-bp').addEventListener('click', async () => {
  await send({
    type: 'set-block-page',
    payload: {
      title: $<HTMLInputElement>('bp-title').value,
      message: $<HTMLInputElement>('bp-message').value,
      type: $<HTMLSelectElement>('bp-type').value as 'message' | 'redirect',
      redirectUrl: $<HTMLInputElement>('bp-redirect').value,
      autoCloseSeconds: Math.max(0, Number($<HTMLInputElement>('bp-autoclose').value) || 0),
      showCountdown: $<HTMLInputElement>('bp-countdown-toggle').checked,
      defaultCountdownMs: Math.max(1, Number($<HTMLInputElement>('bp-countdown-min').value) || 1) * 60000,
    },
  });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  flashMsg(t('bpSaved'));
});
$('btn-save-variants').addEventListener('click', async () => {
  await send({
    type: 'set-variants',
    payload: {
      variants: {
        includeSubdomains: $<HTMLInputElement>('v-sub').checked,
        includeTldVariants: $<HTMLInputElement>('v-tld').checked,
        includeKnownMirrors: $<HTMLInputElement>('v-mirror').checked,
      },
    },
  });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
  flashMsg(t('variantSaved'));
});

// ---------- 密码与安全问题 ----------
$('pwd-toggle').addEventListener('change', async (e) => {
  await send({ type: 'set-password-enabled', payload: { enabled: (e.target as HTMLInputElement).checked } });
  if ((e.target as HTMLInputElement).checked && !state.password.hash) {
    $<HTMLButtonElement>('btn-gen-pwd').click();
  }
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});
$('btn-gen-pwd').addEventListener('click', async () => {
  const res = await send({ type: 'reset-password' });
  if (!res.ok) return;
  $('pwd-value').textContent = res.password;
  $('pwd-show').classList.remove('hidden');
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});
$('btn-copy-pwd').addEventListener('click', async () => {
  const text = $('pwd-value').textContent ?? '';
  await navigator.clipboard.writeText(text);
  const btn = $<HTMLButtonElement>('btn-copy-pwd');
  const old = btn.textContent;
  btn.textContent = t('pwdCopied');
  setTimeout(() => (btn.textContent = old), 1500);
});

const secSelect = $<HTMLSelectElement>('sec-question');
for (const q of SECURITY_QUESTIONS) {
  const opt = document.createElement('option');
  opt.value = q;
  opt.textContent = q;
  secSelect.appendChild(opt);
}
$('btn-save-security').addEventListener('click', async () => {
  const question = secSelect.value;
  const answer = $<HTMLInputElement>('sec-answer').value.trim();
  if (!answer) {
    flashMsg(t('pwdSecurityNeedAnswer'), true);
    return;
  }
  const res = await send({ type: 'set-security-question', payload: { question, answer } });
  flashMsg(res.ok ? t('pwdSecuritySaved') : (res.error ?? t('saveFailed')), !res.ok);
  $<HTMLInputElement>('sec-answer').value = '';
});

// ---------- 数据 ----------
$('btn-export').addEventListener('click', async () => {
  const { json } = await send({ type: 'export-snapshot' });
  download(json, `li-web-interceptor-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  flashMsg(t('dataExported'));
});
$('btn-import').addEventListener('click', () => $<HTMLInputElement>('import-file').click());
$<HTMLInputElement>('import-file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const json = await file.text();
    await send({ type: 'import-snapshot', payload: { json } });
    state = await send({ type: 'get-state' }).then((r) => r.state);
    refresh();
    flashMsg(t('dataImported'));
  } catch (err) {
    flashMsg(t('dataImportFail', [(err as Error).message]), true);
  }
  (e.target as HTMLInputElement).value = '';
});
$('btn-export-csv').addEventListener('click', async () => {
  const r = await send({ type: 'export-csv', payload: { kind: 'block' } });
  download(r.csv, r.filename, 'text/csv');
});
$('btn-export-wl-csv').addEventListener('click', async () => {
  const r = await send({ type: 'export-csv', payload: { kind: 'whitelist' } });
  download(r.csv, r.filename, 'text/csv');
});
$('btn-reset').addEventListener('click', async () => {
  if (!confirm(t('dataResetConfirm'))) return;
  await send({ type: 'reset-all' });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
  flashMsg(t('dataResetDone'));
});

// ---------- 同步 ----------
function syncProviderFields() {
  const isS3 = $<HTMLSelectElement>('sync-provider').value === 's3';
  $('sync-bucket-field').classList.toggle('hidden', !isS3);
  $('sync-region-field').classList.toggle('hidden', !isS3);
}

function renderSync() {
  const sync = state.sync;
  $<HTMLSelectElement>('sync-provider').value = sync.provider === 's3' ? 's3' : 'webdav';
  syncProviderFields();
  const status = $('sync-status');
  if (sync.lastError) {
    status.textContent = `${t('syncStatus', [t('syncError')])}：${sync.lastError}`;
    status.classList.add('error');
  } else if (sync.lastSyncAt) {
    status.textContent = t('syncLastSync', [new Date(sync.lastSyncAt).toLocaleString()]);
    status.classList.remove('error');
  } else {
    status.textContent = t('syncStatus', [t('syncNever')]);
    status.classList.remove('error');
  }
}

$<HTMLSelectElement>('sync-provider').addEventListener('change', syncProviderFields);

$('btn-sync-save').addEventListener('click', async () => {
  const provider = $<HTMLSelectElement>('sync-provider').value as 'webdav' | 's3';
  await send({
    type: 'set-sync-config',
    payload: {
      provider,
      endpoint: $<HTMLInputElement>('sync-endpoint').value.trim(),
      path: $<HTMLInputElement>('sync-path').value.trim() || 'liwi-sync.json',
      region: $<HTMLInputElement>('sync-region').value.trim() || 'us-east-1',
      bucket: $<HTMLInputElement>('sync-bucket').value.trim(),
      username: $<HTMLInputElement>('sync-user').value,
      password: $<HTMLInputElement>('sync-pass').value,
      accessKey: $<HTMLInputElement>('sync-user').value,
      secretKey: $<HTMLInputElement>('sync-pass').value,
    },
  });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  renderSync();
  flashMsg(t('syncConfigSaved'));
});

$('btn-sync-test').addEventListener('click', async () => {
  const provider = $<HTMLSelectElement>('sync-provider').value as 'webdav' | 's3';
  const res = await send({ type: 'sync-test', payload: { provider } });
  flashMsg(res.error ?? t('syncOk'), !res.ok);
  state = await send({ type: 'get-state' }).then((r) => r.state);
  renderSync();
});

$('btn-sync-push').addEventListener('click', async () => {
  const res = await send({ type: 'sync-push' });
  flashMsg(res.ok ? t('syncPushed') : (res.error ?? t('saveFailed')), !res.ok);
  state = await send({ type: 'get-state' }).then((r) => r.state);
  renderSync();
});

$('btn-sync-pull').addEventListener('click', async () => {
  if (!confirm(t('syncPullConfirm'))) return;
  const res = await send({ type: 'sync-pull' });
  if (res.ok) {
    state = await send({ type: 'get-state' }).then((r) => r.state);
    refresh();
    flashMsg(t('syncPulled'));
  } else {
    flashMsg(res.error === 'remote-empty' ? t('syncPullNoRemote') : (res.error ?? t('saveFailed')), true);
  }
});

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

let msgTimer: ReturnType<typeof setTimeout> | undefined;
function flashMsg(text: string, isError = false) {
  const el = $('data-msg');
  el.textContent = text;
  el.classList.toggle('error', isError);
  if (msgTimer) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (el.textContent = ''), 4000);
}

syncBlockParams();
syncWlParams();
refresh();
pomoTimer = setInterval(async () => {
  const r = await send({ type: 'pomodoro-get' });
  state.pomodoro = r.state;
  renderPomodoro();
}, 1000);
