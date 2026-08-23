/**
 * 消息协议：UI（popup/options/blocked）与 background 之间的通信。
 */
import { browser } from 'wxt/browser';
import type {
  AppState,
  BlockRule,
  BlockType,
  MatchMode,
  PomodoroState,
  Theme,
  TimeWindow,
  WhitelistRule,
  WhitelistType,
} from './types';

export interface AddBlockPayload {
  text: string;
  matchMode: MatchMode;
  blockType: BlockType;
  attempts?: number;
  durationMs?: number | null;
  schedule?: TimeWindow;
  redirectUrl?: string;
  reason?: string;
  tabId?: number;
  url?: string;
}

export interface AddWhitelistPayload {
  text: string;
  matchMode: MatchMode;
  type: WhitelistType;
  attempts?: number;
  schedule?: TimeWindow;
}

export interface SyncConfigPayload {
  provider: 'webdav' | 's3';
  endpoint: string;
  path: string;
  username?: string;
  password?: string;
  region?: string;
  bucket?: string;
  accessKey?: string;
  secretKey?: string;
}

export type Message =
  | { type: 'get-state' }
  | { type: 'get-tab-info' }
  | { type: 'add-block'; payload: AddBlockPayload }
  | { type: 'remove-block'; payload: { id: string } }
  | { type: 'update-block'; payload: { id: string; changes: Partial<Omit<BlockRule, 'id' | 'text'>> } }
  | { type: 'set-rule-status'; payload: { id: string; status: 'blocked' | 'unblocked' } }
  | { type: 'add-whitelist'; payload: AddWhitelistPayload }
  | { type: 'remove-whitelist'; payload: { id: string } }
  | { type: 'update-whitelist'; payload: { id: string; changes: Partial<Omit<WhitelistRule, 'id' | 'text'>> } }
  | { type: 'set-whitelist-status'; payload: { id: string; status: 'allowed' | 'not-allowed' } }
  | { type: 'add-keyword'; payload: { keyword: string } }
  | { type: 'remove-keyword'; payload: { id: string } }
  | { type: 'toggle-keyword'; payload: { id: string; enabled: boolean } }
  | { type: 'set-keyword-blocking'; payload: { enabled: boolean } }
  | { type: 'set-whitelist-mode'; payload: { enabled: boolean } }
  | { type: 'set-silent-mode'; payload: { enabled: boolean } }
  | { type: 'set-lock-enabled'; payload: { enabled: boolean } }
  | { type: 'set-history-enabled'; payload: { enabled: boolean } }
  | { type: 'set-cooldown'; payload: { minutes: number } }
  | { type: 'set-password-enabled'; payload: { enabled: boolean } }
  | { type: 'reset-password' }
  | { type: 'set-security-question'; payload: { question: string; answer: string } }
  | { type: 'reset-password-via-security'; payload: { answer: string } }
  | { type: 'verify-password'; payload: { password: string } }
  | { type: 'set-block-page'; payload: Partial<AppState['profiles'][number]['settings']['blockPage']> }
  | { type: 'set-variants'; payload: { variants: AppState['profiles'][number]['settings']['variants'] } }
  | { type: 'create-profile'; payload: { name: string; inherit: boolean } }
  | { type: 'switch-profile'; payload: { id: string } }
  | { type: 'rename-profile'; payload: { id: string; name: string } }
  | { type: 'delete-profile'; payload: { id: string } }
  | { type: 'start-countdown'; payload: { host: string; minutes: number } }
  | { type: 'session-unlock'; payload: { host: string; minutes: number } }
  | { type: 'remove-countdown'; payload: { host: string } }
  | { type: 'export-snapshot' }
  | { type: 'import-snapshot'; payload: { json: string } }
  | { type: 'export-csv'; payload: { kind: 'block' | 'whitelist' } }
  | { type: 'clear-history' }
  | { type: 'reset-attempts' }
  | { type: 'reset-all' }
  | { type: 'pomodoro-start'; payload: { focusMinutes: number; breakMinutes: number; totalCycles: number } }
  | { type: 'pomodoro-pause' }
  | { type: 'pomodoro-resume' }
  | { type: 'pomodoro-stop' }
  | { type: 'pomodoro-get' }
  | { type: 'set-theme'; payload: { theme: Theme } }
  | { type: 'set-sync-config'; payload: SyncConfigPayload }
  | { type: 'sync-test'; payload: { provider: 'webdav' | 's3' } }
  | { type: 'sync-push' }
  | { type: 'sync-pull' };

export type MessageResponse<T extends Message> = T extends { type: 'get-state' }
  ? { ok: true; state: AppState }
  : T extends { type: 'get-tab-info' }
    ? { ok: true; url: string | null; host: string | null; tabId: number | undefined }
    : T extends { type: 'add-block' }
      ? { ok: true; rule: BlockRule }
      : T extends { type: 'reset-password' | 'reset-password-via-security' }
        ? { ok: true; password: string } | { ok: false; error: string }
        : T extends { type: 'verify-password' }
          ? { ok: true; valid: boolean }
          : T extends { type: 'export-snapshot' }
            ? { ok: true; json: string }
            : T extends { type: 'export-csv' }
              ? { ok: true; csv: string; filename: string }
              : T extends { type: 'set-lock-enabled' | 'delete-profile' | 'set-security-question' }
                ? { ok: boolean; error?: string; remainingMs?: number }
                : T extends { type: 'pomodoro-get' }
                  ? { ok: true; state: PomodoroState; remainingSec: number }
                  : T extends { type: 'sync-test' | 'sync-push' | 'sync-pull' }
                    ? { ok: boolean; error?: string }
                    : { ok: true };

export function send<T extends Message>(message: T): Promise<MessageResponse<T>> {
  return browser.runtime.sendMessage(message) as Promise<MessageResponse<T>>;
}
