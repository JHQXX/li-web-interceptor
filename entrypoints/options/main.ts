import './style.css';
import { send } from '@/utils/messaging';
import { parseClockToMin, minToClock } from '@/utils/time';
import type { AppState } from '@/utils/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state: AppState = await send({ type: 'get-state' }).then((r) => r.state);

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

// ---------- 拦截列表 ----------
function renderBlockList() {
  const tbody = $('block-tbody');
  tbody.innerHTML = '';
  if (state.blockList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">还没有拦截任何网站</td></tr>';
    return;
  }
  for (const rule of state.blockList) {
    const tr = document.createElement('tr');

    const tdHost = document.createElement('td');
    const host = document.createElement('div');
    host.className = 'hostname';
    host.textContent = rule.hostname;
    const patterns = document.createElement('div');
    patterns.className = 'patterns';
    patterns.textContent = rule.patterns.join(', ');
    tdHost.appendChild(host);
    tdHost.appendChild(patterns);

    const tdCount = document.createElement('td');
    const count = document.createElement('input');
    count.type = 'number';
    count.min = '0';
    count.className = 'mini-input';
    count.value = rule.options.countdownMs != null ? String(Math.round(rule.options.countdownMs / 60000)) : '0';
    count.title = '默认倒计时(分钟)，0 表示不自动倒计时';
    count.addEventListener('change', async () => {
      const minutes = Math.max(0, Number(count.value) || 0);
      await send({ type: 'update-block', payload: { id: rule.id, changes: { countdownMs: minutes > 0 ? minutes * 60000 : null } } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
    });
    tdCount.appendChild(count);

    const tdOpts = document.createElement('td');
    const opts = document.createElement('div');
    opts.className = 'cell-opts';
    const subLabel = document.createElement('label');
    subLabel.innerHTML = '<input type="checkbox" class="mini-check" /> 子域';
    const subInput = subLabel.querySelector('input')!;
    subInput.checked = rule.options.includeSubdomains;
    subInput.addEventListener('change', async () => {
      await send({ type: 'update-block', payload: { id: rule.id, changes: { includeSubdomains: subInput.checked } } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
    });
    const varLabel = document.createElement('label');
    varLabel.innerHTML = '<input type="checkbox" class="mini-check" /> 变体/镜像';
    const varInput = varLabel.querySelector('input')!;
    varInput.checked = rule.options.includeVariants;
    varInput.addEventListener('change', async () => {
      await send({ type: 'update-block', payload: { id: rule.id, changes: { includeVariants: varInput.checked } } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
    });
    opts.appendChild(subLabel);
    opts.appendChild(varLabel);
    tdOpts.appendChild(opts);

    const tdRm = document.createElement('td');
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.title = '移除';
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-block', payload: { id: rule.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderBlockList();
    });
    tdRm.appendChild(rm);

    tr.appendChild(tdHost);
    tr.appendChild(tdCount);
    tr.appendChild(tdOpts);
    tr.appendChild(tdRm);
    tbody.appendChild(tr);
  }
}

// ---------- 白名单 ----------
function renderWhitelist() {
  const tbody = $('wl-tbody');
  tbody.innerHTML = '';
  if (state.whitelist.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">白名单为空</td></tr>';
    return;
  }
  for (const rule of state.whitelist) {
    const tr = document.createElement('tr');
    const tdHost = document.createElement('td');
    const host = document.createElement('div');
    host.className = 'hostname';
    host.textContent = rule.hostname;
    const patterns = document.createElement('div');
    patterns.className = 'patterns';
    patterns.textContent = rule.patterns.join(', ');
    tdHost.appendChild(host);
    tdHost.appendChild(patterns);
    const tdRm = document.createElement('td');
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-whitelist', payload: { id: rule.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderWhitelist();
    });
    tdRm.appendChild(rm);
    tr.appendChild(tdHost);
    tr.appendChild(tdRm);
    tbody.appendChild(tr);
  }
}

// ---------- 允许时段 ----------
function renderSchedules() {
  const ul = $('sch-list');
  ul.innerHTML = '';
  if (state.schedules.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '没有设置允许时段';
    ul.appendChild(li);
    return;
  }
  const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
  for (const s of state.schedules) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const host = document.createElement('span');
    host.className = 'hostname';
    const days = s.days.length === 0 ? '每天' : s.days.map((d) => `周${DAY_NAMES[d]}`).join(' ');
    host.textContent = `${days} ${minToClock(s.startMin)} - ${minToClock(s.endMin)}`;
    left.appendChild(host);
    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:12px;';
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'switch-row';
    toggleLabel.textContent = '启用';
    const sw = document.createElement('label');
    sw.className = 'switch';
    sw.innerHTML = '<input type="checkbox" /><span class="slider"></span>';
    const input = sw.querySelector('input')!;
    input.checked = s.enabled;
    input.addEventListener('change', async () => {
      await send({ type: 'toggle-schedule', payload: { id: s.id, enabled: input.checked } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
    });
    toggleLabel.appendChild(sw);
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-schedule', payload: { id: s.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderSchedules();
    });
    right.appendChild(toggleLabel);
    right.appendChild(rm);
    li.appendChild(left);
    li.appendChild(right);
    ul.appendChild(li);
  }
}

function refresh() {
  renderBlockList();
  renderWhitelist();
  renderSchedules();
  $<HTMLInputElement>('lock-toggle').checked = state.settings.lockEnabled;
  $<HTMLInputElement>('pwd-toggle').checked = state.settings.password.enabled;
  $<HTMLInputElement>('bp-title').value = state.settings.blockPage.title;
  $<HTMLInputElement>('bp-message').value = state.settings.blockPage.message;
  $<HTMLInputElement>('bp-countdown-toggle').checked = state.settings.blockPage.showCountdown;
  $<HTMLInputElement>('bp-countdown-min').value = String(Math.round(state.settings.blockPage.defaultCountdownMs / 60000));
  $<HTMLInputElement>('v-sub').checked = state.settings.variants.includeSubdomains;
  $<HTMLInputElement>('v-tld').checked = state.settings.variants.includeTldVariants;
  $<HTMLInputElement>('v-mirror').checked = state.settings.variants.includeKnownMirrors;
}

// --- 拦截列表 ---
$('btn-add-block').addEventListener('click', async () => {
  const input = $<HTMLInputElement>('block-input');
  const host = input.value.trim();
  if (!host) return;
  await send({ type: 'add-block', payload: { host } });
  input.value = '';
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});
$<HTMLInputElement>('block-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $<HTMLButtonElement>('btn-add-block').click();
});

// --- 白名单 ---
$('btn-add-wl').addEventListener('click', async () => {
  const input = $<HTMLInputElement>('wl-input');
  const host = input.value.trim();
  if (!host) return;
  await send({ type: 'add-whitelist', payload: { host } });
  input.value = '';
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});

// --- 时段 ---
$('btn-add-sch').addEventListener('click', async () => {
  const days = [...document.querySelectorAll<HTMLInputElement>('.days input:checked')].map((i) => Number(i.value));
  const startMin = parseClockToMin($<HTMLInputElement>('sch-start').value || '09:00');
  const endMin = parseClockToMin($<HTMLInputElement>('sch-end').value || '18:00');
  await send({ type: 'add-schedule', payload: { days, startMin, endMin } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});

// --- 总开关 ---
$('lock-toggle').addEventListener('change', async (e) => {
  await send({ type: 'set-lock-enabled', payload: { enabled: (e.target as HTMLInputElement).checked } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
});

// --- 密码 ---
$('pwd-toggle').addEventListener('change', async (e) => {
  await send({ type: 'set-password-enabled', payload: { enabled: (e.target as HTMLInputElement).checked } });
  if ((e.target as HTMLInputElement).checked && !state.settings.password.hash) {
    $<HTMLButtonElement>('btn-gen-pwd').click();
  }
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});

$('btn-gen-pwd').addEventListener('click', async () => {
  const { password } = await send({ type: 'reset-password' });
  $('pwd-value').textContent = password;
  $('pwd-show').classList.remove('hidden');
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});

$('btn-copy-pwd').addEventListener('click', async () => {
  const text = $('pwd-value').textContent ?? '';
  await navigator.clipboard.writeText(text);
  const btn = $<HTMLButtonElement>('btn-copy-pwd');
  const old = btn.textContent;
  btn.textContent = '已复制';
  setTimeout(() => (btn.textContent = old), 1500);
});

// --- 拦截页设置 ---
$('btn-save-bp').addEventListener('click', async () => {
  await send({
    type: 'set-block-page',
    payload: {
      title: $<HTMLInputElement>('bp-title').value,
      message: $<HTMLInputElement>('bp-message').value,
      showCountdown: $<HTMLInputElement>('bp-countdown-toggle').checked,
      defaultCountdownMs: Math.max(1, Number($<HTMLInputElement>('bp-countdown-min').value) || 1) * 60000,
    },
  });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  flashMsg('拦截页设置已保存');
});

// --- 衍生策略 ---
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
  flashMsg('衍生策略已保存');
});

// --- 数据 ---
$('btn-export').addEventListener('click', async () => {
  const { json } = await send({ type: 'export-snapshot' });
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `li-web-interceptor-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  flashMsg('已导出数据文件');
});

$('btn-import').addEventListener('click', () => {
  $<HTMLInputElement>('import-file').click();
});
$<HTMLInputElement>('import-file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const json = await file.text();
    await send({ type: 'import-snapshot', payload: { json } });
    state = await send({ type: 'get-state' }).then((r) => r.state);
    refresh();
    flashMsg('导入成功');
  } catch (err) {
    flashMsg(`导入失败：${(err as Error).message}`, true);
  }
  (e.target as HTMLInputElement).value = '';
});

$('btn-reset').addEventListener('click', async () => {
  if (!confirm('确定清空所有拦截数据？此操作不可恢复。')) return;
  await send({ type: 'reset-all' });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
  flashMsg('已清空数据');
});

// --- 付费同步（禁用态） ---
$('btn-sync-test').addEventListener('click', async () => {
  const provider = $<HTMLSelectElement>('sync-provider').value as 'webdav' | 's3';
  const res = await send({ type: 'sync-test', payload: { provider } });
  flashMsg(res.error ?? '连接成功', !res.ok);
});

let msgTimer: ReturnType<typeof setTimeout> | undefined;
function flashMsg(text: string, isError = false) {
  const el = $('data-msg');
  el.textContent = text;
  el.classList.toggle('error', isError);
  if (msgTimer) clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (el.textContent = ''), 4000);
}

refresh();
