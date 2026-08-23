/**
 * 消息协议：UI（popup/options/blocked）与 background 之间的通信。
 */
import { browser } from 'wxt/browser';
import type { AppState, BlockRule, VariantSettings } from './types';

export type Message =
  | { type: 'get-state' }
  | { type: 'get-tab-info' }
  | { type: 'add-block'; payload: { host: string; reason?: string } }
  | { type: 'remove-block'; payload: { id: string } }
  | { type: 'update-block'; payload: { id: string; changes: Partial<BlockRule['options']> & { reason?: string } } }
  | { type: 'add-whitelist'; payload: { host: string } }
  | { type: 'remove-whitelist'; payload: { id: string } }
  | { type: 'set-lock-enabled'; payload: { enabled: boolean } }
  | { type: 'set-password-enabled'; payload: { enabled: boolean } }
  | { type: 'reset-password' }
  | { type: 'verify-password'; payload: { password: string } }
  | { type: 'set-block-page'; payload: { title?: string; message?: string; showCountdown?: boolean; defaultCountdownMs?: number } }
  | { type: 'set-variants'; payload: { variants: VariantSettings } }
  | { type: 'add-schedule'; payload: { days: number[]; startMin: number; endMin: number } }
  | { type: 'remove-schedule'; payload: { id: string } }
  | { type: 'toggle-schedule'; payload: { id: string; enabled: boolean } }
  | { type: 'start-countdown'; payload: { host: string; minutes: number } }
  | { type: 'session-unlock'; payload: { host: string; minutes: number } }
  | { type: 'remove-countdown'; payload: { host: string } }
  | { type: 'export-snapshot' }
  | { type: 'import-snapshot'; payload: { json: string } }
  | { type: 'reset-all' }
  | { type: 'sync-test'; payload: { provider: 'webdav' | 's3' } };

export type MessageResponse<T extends Message> = T extends { type: 'get-state' }
  ? { ok: true; state: AppState }
  : T extends { type: 'get-tab-info' }
    ? { ok: true; url: string | null; host: string | null }
    : T extends { type: 'add-block' }
      ? { ok: true; rule: BlockRule }
      : T extends { type: 'reset-password' }
        ? { ok: true; password: string }
        : T extends { type: 'verify-password' }
          ? { ok: true; valid: boolean }
          : T extends { type: 'export-snapshot' }
            ? { ok: true; json: string }
            : T extends { type: 'sync-test' }
              ? { ok: boolean; error?: string }
              : { ok: true };

export function send<T extends Message>(message: T): Promise<MessageResponse<T>> {
  return browser.runtime.sendMessage(message) as Promise<MessageResponse<T>>;
}
