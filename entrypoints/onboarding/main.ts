import './style.css';
import { browser } from 'wxt/browser';
import { send } from '@/utils/messaging';
import { setLang, applyI18n, applyI18nWhenReady } from '@/utils/i18n';
import { applyTheme } from '@/utils/theme';

document.documentElement.classList.add('pre-i18n');

const state = await send({ type: 'get-state' }).then((r) => r.state);
setLang(state.lang);
applyI18n();
applyI18nWhenReady();
applyTheme(state.theme);
document.documentElement.classList.remove('pre-i18n');

document.getElementById('btn-start')!.addEventListener('click', async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) await browser.tabs.remove(tab.id).catch(() => {});
  await browser.runtime.openOptionsPage();
});
document.getElementById('btn-settings')!.addEventListener('click', async () => {
  await browser.runtime.openOptionsPage();
});
