import { browser } from 'wxt/browser';

import './style.css';
import { send } from '@/utils/messaging';
import { decideHost, findRule } from '@/utils/rules';
import { formatRemaining } from '@/utils/time';

const params = new URLSearchParams(location.search);
const originalUrl = params.get('url') ?? '';
const site = params.get('site') ?? '';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state = await send({ type: 'get-state' }).then((r) => r.state);

function render() {
  const decision = decideHost(site, state, Date.now());
  const title = state.settings.blockPage.title;
  const message = state.settings.blockPage.message;
  const pwdEnabled = state.settings.password.enabled;

  $('title').textContent = title;
  $('message').textContent = message;
  $('site').textContent = site || '未知网站';

  const countdown = $('countdown');
  const btnContinue = $('btn-continue');
  const btnUnlock = $('btn-unlock');

  if (decision.status === 'blocked') {
    btnContinue.classList.add('hidden');
    btnUnlock.classList.remove('hidden');
    btnUnlock.textContent = '需要提前访问';
    if (decision.countdownRemainingMs != null && state.settings.blockPage.showCountdown) {
      countdown.classList.remove('hidden');
      countdown.textContent = `距可访问还有 ${formatRemaining(decision.countdownRemainingMs)}`;
    } else {
      countdown.classList.add('hidden');
    }
  } else {
    countdown.classList.add('hidden');
    btnContinue.classList.remove('hidden');
    btnContinue.textContent = '现在可以访问，继续';
    btnUnlock.classList.add('hidden');
  }
}

function goBack() {
  const target = originalUrl || `https://${site}`;
  location.href = target;
}

function openModal() {
  const pwdEnabled = state.settings.password.enabled;
  const input = $('pwd-input') as HTMLInputElement;
  const hint = $('pwd-hint');
  const unlockOptions = $('unlock-options');
  const okBtn = $('btn-pwd-ok');
  input.value = '';
  $('pwd-error').classList.add('hidden');

  if (!pwdEnabled) {
    hint.textContent = '未启用随机密码保护，可直接操作：';
    input.classList.add('hidden');
    okBtn.classList.add('hidden');
    unlockOptions.classList.remove('hidden');
  } else {
    hint.textContent = '输入随机密码（仅首次设置时展示一次）：';
    input.classList.remove('hidden');
    okBtn.classList.remove('hidden');
    unlockOptions.classList.add('hidden');
  }
  $('modal').classList.remove('hidden');
  if (!input.classList.contains('hidden')) input.focus();
}

function closeModal() {
  $('modal').classList.add('hidden');
}

async function submitPassword() {
  const input = $('pwd-input') as HTMLInputElement;
  const { valid } = await send({ type: 'verify-password', payload: { password: input.value } });
  if (!valid) {
    $('pwd-error').classList.remove('hidden');
    return;
  }
  $('pwd-error').classList.add('hidden');
  $('pwd-hint').textContent = '密码正确，请选择操作：';
  input.classList.add('hidden');
  $('btn-pwd-ok').classList.add('hidden');
  $('unlock-options').classList.remove('hidden');
}

async function sessionUnlockAndGo() {
  const minutes = Number(($('session-min') as HTMLSelectElement).value) || 5;
  await send({ type: 'session-unlock', payload: { host: site, minutes } });
  goBack();
}

async function removeRuleAndGo() {
  const rule = findRule(site, state.blockList);
  if (rule) {
    await send({ type: 'remove-block', payload: { id: rule.id } });
    await send({ type: 'remove-countdown', payload: { host: site } });
  }
  goBack();
}

$('btn-continue').addEventListener('click', goBack);
$('btn-unlock').addEventListener('click', openModal);
$('btn-pwd-ok').addEventListener('click', submitPassword);
$('btn-pwd-cancel').addEventListener('click', closeModal);
$('btn-session').addEventListener('click', sessionUnlockAndGo);
$('btn-remove').addEventListener('click', removeRuleAndGo);
$('modal').addEventListener('click', (e) => {
  if (e.target === $('modal')) closeModal();
});
$('link-options').addEventListener('click', (e) => {
  e.preventDefault();
  location.href = browser.runtime.getURL('/options.html');
});
($('pwd-input') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPassword();
});

render();
setInterval(() => {
  const decision = decideHost(site, state, Date.now());
  if (decision.status === 'blocked' && decision.countdownRemainingMs != null) {
    $('countdown').textContent = `距可访问还有 ${formatRemaining(decision.countdownRemainingMs)}`;
  } else {
    render();
  }
}, 1000);
