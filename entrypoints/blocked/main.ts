import './style.css';
import { browser } from 'wxt/browser';
import { send } from '@/utils/messaging';
import { decide, findBlockRule } from '@/utils/rules';
import { getActiveProfile } from '@/utils/storage';
import { formatRemaining } from '@/utils/time';
import { t , applyI18n, applyI18nWhenReady } from '@/utils/i18n';

applyI18n();
applyI18nWhenReady();
import type { AppState, BlockRule } from '@/utils/types';

const params = new URLSearchParams(location.search);
const originalUrl = params.get('url') ?? '';
const site = params.get('site') ?? '';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state: AppState = await send({ type: 'get-state' }).then((r) => r.state);
let currentRule: BlockRule | undefined;

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}

function decisionNow() {
  const profile = getActiveProfile(state);
  const url = originalUrl || `https://${site}`;
  return decide(url, site, {
    blockList: profile.blockList,
    whitelist: profile.whitelist,
    keywords: profile.keywords,
    keywordBlockingEnabled: profile.settings.keywordBlockingEnabled,
    whitelistMode: profile.settings.whitelistMode,
    sessionUnlocks: state.sessionUnlocks,
    activeCountdowns: state.activeCountdowns,
    activeTimewise: state.activeTimewise,
    attemptState: state.attemptState,
    whitelistAttemptState: state.whitelistAttemptState,
  });
}

function render() {
  const profile = getActiveProfile(state);
  const decision = decisionNow();
  $('title').textContent = profile.settings.blockPage.title;
  $('message').textContent = profile.settings.blockPage.message;
  $('site').textContent = site || t('unknown');
  currentRule = decision.status === 'blocked' ? decision.rule : undefined;

  const countdown = $('countdown');
  const btnContinue = $('btn-continue');
  const btnTimer = $('btn-timer');
  const btnUnlock = $('btn-unlock');

  if (decision.status === 'blocked') {
    btnContinue.classList.add('hidden');
    btnTimer.classList.remove('hidden');
    btnUnlock.classList.remove('hidden');
    if (decision.countdownRemainingMs != null && profile.settings.blockPage.showCountdown) {
      countdown.classList.remove('hidden');
      countdown.textContent = t('blockedCountdown', [formatRemaining(decision.countdownRemainingMs)]);
    } else {
      countdown.classList.add('hidden');
    }
  } else {
    countdown.classList.add('hidden');
    btnContinue.classList.remove('hidden');
    btnContinue.textContent = t('blockedNowAccessible');
    btnTimer.classList.add('hidden');
    btnUnlock.classList.add('hidden');
  }

  // 自动关闭
  const autoClose = $('auto-close');
  const sec = profile.settings.blockPage.autoCloseSeconds;
  if (sec > 0 && decision.status === 'blocked') {
    autoClose.classList.remove('hidden');
    autoClose.textContent = t('blockedAutoClose', [sec]);
  } else {
    autoClose.classList.add('hidden');
  }
}

function goBack() {
  const target = originalUrl || `https://${site}`;
  location.href = target;
}

function openModal() {
  const profile = getActiveProfile(state);
  const pwdEnabled = state.password.enabled;
  const input = $<HTMLInputElement>('pwd-input');
  input.value = '';
  $<HTMLInputElement>('sec-input').value = '';
  $('pwd-error').classList.add('hidden');
  $('new-pwd-box').classList.add('hidden');
  $('unlock-options').classList.add('hidden');
  $('sec-wrap').classList.add('hidden');
  $('btn-forget').classList.toggle('hidden', !pwdEnabled);
  if (!pwdEnabled) {
    $('pwd-hint').textContent = t('blockedNoPwd');
    input.classList.add('hidden');
    $('btn-pwd-ok').classList.add('hidden');
    $('unlock-options').classList.remove('hidden');
  } else {
    $('pwd-hint').textContent = t('blockedPwdHint');
    input.classList.remove('hidden');
    $('btn-pwd-ok').classList.remove('hidden');
    input.focus();
  }
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
}

async function submitPassword() {
  const input = $<HTMLInputElement>('pwd-input');
  const { valid } = await send({ type: 'verify-password', payload: { password: input.value } });
  if (!valid) {
    const err = $('pwd-error');
    err.textContent = t('blockedWrongPwd');
    err.classList.remove('hidden');
    return;
  }
  showUnlockOptions();
}

function showUnlockOptions() {
  $('pwd-error').classList.add('hidden');
  $('pwd-hint').textContent = t('blockedChooseAction');
  $<HTMLInputElement>('pwd-input').classList.add('hidden');
  $('btn-pwd-ok').classList.add('hidden');
  $('btn-forget').classList.add('hidden');
  $('sec-wrap').classList.add('hidden');
  $('unlock-options').classList.remove('hidden');
}

function showSecurityQuestion() {
  const sec = state.security;
  if (!sec.question) return;
  $('pwd-hint').textContent = t('blockedSecHint');
  $<HTMLInputElement>('pwd-input').classList.add('hidden');
  $('btn-pwd-ok').classList.remove('hidden');
  $('btn-forget').classList.add('hidden');
  $('sec-question').textContent = t('blockedSecQuestion', [sec.question]);
  $('sec-wrap').classList.remove('hidden');
  $<HTMLInputElement>('sec-input').focus();
}

async function submitSecurityAnswer() {
  const answer = $<HTMLInputElement>('sec-input').value;
  const res = await send({ type: 'reset-password-via-security', payload: { answer } });
  if (!res.ok) {
    const err = $('pwd-error');
    err.textContent = res.error ?? t('blockedSecWrong');
    err.classList.remove('hidden');
    return;
  }
  $('pwd-error').classList.add('hidden');
  $('sec-wrap').classList.add('hidden');
  $('btn-pwd-ok').classList.add('hidden');
  $('new-pwd-box').classList.remove('hidden');
  $('new-pwd-value').textContent = res.password;
  $('pwd-hint').textContent = t('blockedPwdReset');
  // 展示后进入操作选项
  setTimeout(() => {
    $('new-pwd-box').classList.add('hidden');
    showUnlockOptions();
  }, 6000);
}

async function sessionUnlockAndGo() {
  const minutes = Number(($('session-min') as HTMLSelectElement).value) || 5;
  await send({ type: 'session-unlock', payload: { host: site, minutes } });
  goBack();
}

async function removeRuleAndGo() {
  const rule = currentRule ?? findBlockRule(originalUrl || `https://${site}`, site, getActiveProfile(state).blockList);
  if (rule) {
    await send({ type: 'remove-block', payload: { id: rule.id } });
    await send({ type: 'remove-countdown', payload: { host: site } });
  }
  goBack();
}

async function startCountdown() {
  const profile = getActiveProfile(state);
  const minutes = Math.max(1, Math.round(profile.settings.blockPage.defaultCountdownMs / 60000));
  await send({ type: 'start-countdown', payload: { host: site, minutes } });
  state = await send({ type: 'get-state' }).then((r) => r.state);
  render();
}

async function autoClose() {
  const profile = getActiveProfile(state);
  const sec = profile.settings.blockPage.autoCloseSeconds;
  if (sec <= 0) return;
  const tab = await browser.tabs.getCurrent();
  if (tab?.id != null) {
    setTimeout(() => browser.tabs.remove(tab.id!).catch(() => {}), sec * 1000);
  }
}

$('btn-continue').addEventListener('click', goBack);
$('btn-timer').addEventListener('click', startCountdown);
$('btn-unlock').addEventListener('click', openModal);
$('btn-pwd-ok').addEventListener('click', () => {
  if (!$('sec-wrap').classList.contains('hidden')) submitSecurityAnswer();
  else submitPassword();
});
$('btn-forget').addEventListener('click', showSecurityQuestion);
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
$<HTMLInputElement>('pwd-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPassword();
});
$<HTMLInputElement>('sec-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitSecurityAnswer();
});

applyTheme();
render();
autoClose();

setInterval(() => {
  const decision = decisionNow();
  const profile = getActiveProfile(state);
  if (decision.status === 'blocked' && decision.countdownRemainingMs != null && profile.settings.blockPage.showCountdown) {
    $('countdown').textContent = t('blockedCountdown', [formatRemaining(decision.countdownRemainingMs)]);
  } else {
    render();
  }
}, 1000);
