import './style.css';
import { send } from '@/utils/messaging';
import { parseClockToMin, minToClock } from '@/utils/time';
import type { AppState, BlockRule, WhitelistRule, Schedule } from '@/utils/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state: AppState = await send({ type: 'get-state' }).then((r) => r.state);

function renderBlockList() {
  const ul = $('block-list');
  ul.innerHTML = '';
  if (state.blockList.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有拦截任何网站';
    ul.appendChild(li);
    return;
  }
  for (const rule of state.blockList) {
    const li = document.createElement('li');

    const head = document.createElement('div');
    head.className = 'row-head';
    const host = document.createElement('span');
    host.className = 'hostname';
    host.textContent = rule.hostname;
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-block', payload: { id: rule.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderBlockList();
    });
    head.appendChild(host);
    head.appendChild(rm);

    const patterns = document.createElement('div');
    patterns.className = 'patterns';
    patterns.textContent = `匹配：${rule.patterns.join(', ')}`;

    const opts = document.createElement('div');
    opts.className = 'opts';

    const subLabel = document.createElement('label');
    subLabel.innerHTML = '<input type="checkbox" /> 含子域名';
    const subInput = subLabel.querySelector('input')!;
    subInput.checked = rule.options.includeSubdomains;
    subInput.addEventListener('change', async () => {
      await send({ type: 'update-block', payload: { id: rule.id, changes: { includeSubdomains: subInput.checked } } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
    });

    const varLabel = document.createElement('label');
    varLabel.innerHTML = '<input type="checkbox" /> 含变体/镜像';
    const varInput = varLabel.querySelector('input')!;
    varInput.checked = rule.options.includeVariants;
    varInput.addEventListener('change', async () => {
      await send({ type: 'update-block', payload: { id: rule.id, changes: { includeVariants: varInput.checked } } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
    });

    const cdLabel = document.createElement('label');
    cdLabel.textContent = '默认倒计时(分) ';
    const cdInput = document.createElement('input');
    cdInput.type = 'number';
    cdInput.min = '0';
    cdInput.value = rule.options.countdownMs != null ? String(Math.round(rule.options.countdownMs / 60000)) : '0';
    cdInput.addEventListener('change', async () => {
      const minutes = Math.max(0, Number(cdInput.value) || 0);
      await send({
        type: 'update-block',
        payload: { id: rule.id, changes: { countdownMs: minutes > 0 ? minutes * 60000 : null } },
      });
      state = await send({ type: 'get-state' }).then((r) => r.state);
    });
    cdLabel.appendChild(cdInput);

    opts.appendChild(subLabel);
    opts.appendChild(varLabel);
    opts.appendChild(cdLabel);

    li.appendChild(head);
    li.appendChild(patterns);
    li.appendChild(opts);
    ul.appendChild(li);
  }
}

function renderWhitelist() {
  const ul = $('wl-list');
  ul.innerHTML = '';
  if (state.whitelist.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '白名单为空';
    ul.appendChild(li);
    return;
  }
  for (const rule of state.whitelist) {
    const li = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'row-head';
    const host = document.createElement('span');
    host.className = 'hostname';
    host.textContent = rule.hostname;
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-whitelist', payload: { id: rule.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderWhitelist();
    });
    head.appendChild(host);
    head.appendChild(rm);
    const patterns = document.createElement('div');
    patterns.className = 'patterns';
    patterns.textContent = `匹配：${rule.patterns.join(', ')}`;
    li.appendChild(head);
    li.appendChild(patterns);
    ul.appendChild(li);
  }
}

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
    const head = document.createElement('div');
    head.className = 'row-head';
    const host = document.createElement('span');
    host.className = 'hostname';
    const days = s.days.length === 0 ? '每天' : s.days.map((d) => `周${DAY_NAMES[d]}`).join(' ');
    host.textContent = `${days} ${minToClock(s.startMin)} - ${minToClock(s.endMin)}`;
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.addEventListener('click', async () => {
      await send({ type: 'remove-schedule', payload: { id: s.id } });
      state = await send({ type: 'get-state' }).then((r) => r.state);
      renderSchedules();
    });
    head.appendChild(host);
    head.appendChild(rm);

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

    li.appendChild(head);
    li.appendChild(toggleLabel);
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
  const input = $('block-input') as HTMLInputElement;
  const host = input.value.trim();
  if (!host) return;
  await send({ type: 'add-block', payload: { host } });
  input.value = '';
  state = await send({ type: 'get-state' }).then((r) => r.state);
  refresh();
});
($('block-input') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ($('btn-add-block') as HTMLButtonElement).click();
});

// --- 白名单 ---
$('btn-add-wl').addEventListener('click', async () => {
  const input = $('wl-input') as HTMLInputElement;
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
  const startMin = parseClockToMin(($('sch-start') as HTMLInputElement).value || '09:00');
  const endMin = parseClockToMin(($('sch-end') as HTMLInputElement).value || '18:00');
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
    ($('btn-gen-pwd') as HTMLButtonElement).click();
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
  const btn = $('btn-copy-pwd') as HTMLButtonElement;
  const old = btn.textContent;
  btn.textContent = '已复制';
  setTimeout(() => (btn.textContent = old), 1500);
});

// --- 拦截页设置 ---
$('btn-save-bp').addEventListener('click', async () => {
  await send({
    type: 'set-block-page',
    payload: {
      title: ($('bp-title') as HTMLInputElement).value,
      message: ($('bp-message') as HTMLInputElement).value,
      showCountdown: ($('bp-countdown-toggle') as HTMLInputElement).checked,
      defaultCountdownMs: Math.max(1, Number(($('bp-countdown-min') as HTMLInputElement).value) || 1) * 60000,
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
        includeSubdomains: ($('v-sub') as HTMLInputElement).checked,
        includeTldVariants: ($('v-tld') as HTMLInputElement).checked,
        includeKnownMirrors: ($('v-mirror') as HTMLInputElement).checked,
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
  ($('import-file') as HTMLInputElement).click();
});
($('import-file') as HTMLInputElement).addEventListener('change', async (e) => {
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
  const provider = ($('sync-provider') as HTMLSelectElement).value as 'webdav' | 's3';
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
