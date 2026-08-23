import { browser } from 'wxt/browser';

import './style.css';
import { send } from '@/utils/messaging';
import { decideHost, findRule } from '@/utils/rules';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function refresh() {
  const { state } = await send({ type: 'get-state' });
  const tabInfo = await send({ type: 'get-tab-info' });
  const host = tabInfo.host;

  $<HTMLInputElement>('lock-toggle').checked = state.settings.lockEnabled;
  $('block-count').textContent = String(state.blockList.length);

  // 当前站点
  if (host) {
    $('current-host').textContent = `当前网站：${host}`;
    const decision = decideHost(host, state, Date.now());
    $('btn-block').classList.remove('hidden');
    $('btn-whitelist').classList.remove('hidden');
    const isWhitelisted = state.whitelist.some((r) =>
      r.patterns.some((p) => (p.startsWith('*.') ? host === p.slice(2) || host.endsWith('.' + p.slice(2)) : host === p)),
    );
    if (isWhitelisted) {
      $('btn-block').classList.add('hidden');
      $('btn-whitelist').textContent = '已在白名单';
      $<HTMLButtonElement>('btn-whitelist').disabled = true;
    } else {
      $<HTMLButtonElement>('btn-whitelist').disabled = false;
      $('btn-whitelist').textContent = '加入白名单';
    }
    $('btn-unblock').classList.toggle('hidden', decision.status !== 'blocked');
    if (decision.status === 'blocked') {
      const rule = findRule(host, state.blockList);
      $('btn-unblock').dataset.ruleId = rule?.id ?? '';
    }
  } else {
    $('current-host').textContent = '当前网站：无法识别';
    $('btn-block').classList.add('hidden');
    $('btn-whitelist').classList.add('hidden');
    $('btn-unblock').classList.add('hidden');
  }

  // 拦截列表
  const ul = $('block-list');
  ul.innerHTML = '';
  if (state.blockList.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有拦截任何网站';
    ul.appendChild(li);
  } else {
    for (const rule of state.blockList.slice(0, 20)) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'hostname';
      span.title = rule.patterns.join(', ');
      span.textContent = rule.hostname;
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.textContent = '✕';
      rm.addEventListener('click', async () => {
        await send({ type: 'remove-block', payload: { id: rule.id } });
        refresh();
      });
      li.appendChild(span);
      li.appendChild(rm);
      ul.appendChild(li);
    }
  }
}

$('lock-toggle').addEventListener('change', async (e) => {
  await send({ type: 'set-lock-enabled', payload: { enabled: (e.target as HTMLInputElement).checked } });
});

$('btn-block').addEventListener('click', async () => {
  const tabInfo = await send({ type: 'get-tab-info' });
  if (!tabInfo.host || !tabInfo.tabId || !tabInfo.url) return;
  // 携带当前标签页信息，background 添加后会自动把当前页重定向到拦截页
  await send({
    type: 'add-block',
    payload: { host: tabInfo.host, tabId: tabInfo.tabId, url: tabInfo.url },
  });
  refresh();
  window.close();
});

$('btn-whitelist').addEventListener('click', async () => {
  const tabInfo = await send({ type: 'get-tab-info' });
  if (!tabInfo.host) return;
  await send({ type: 'add-whitelist', payload: { host: tabInfo.host } });
  refresh();
});

$('btn-unblock').addEventListener('click', async () => {
  const id = ($('btn-unblock') as HTMLElement).dataset.ruleId;
  if (id) await send({ type: 'remove-block', payload: { id } });
  refresh();
});

$('link-options').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

refresh();
