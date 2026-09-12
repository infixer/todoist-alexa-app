import type { Envelope, Env, Task, State } from '../src/types';
import { vi } from 'vitest';
export const env: Env = {
  ALEXA_SKILL_ID: 'skill',
  ALLOWED_ALEXA_USER_ID: 'owner',
  TODOIST_API_TOKEN: 'test-token',
};
export const now = Date.parse('2026-09-12T03:00:00Z');
export function envelope(name = 'ListTodayIntent', state?: State, value?: string): Envelope {
  return {
    version: '1.0',
    session: {
      new: !state,
      sessionId: 'session',
      application: { applicationId: 'skill' },
      user: { userId: 'owner' },
      attributes: state ? { state } : {},
    },
    context: {
      System: {
        application: { applicationId: 'skill' },
        user: { userId: 'owner' },
        device: { deviceId: 'echo', supportedInterfaces: {} },
      },
    },
    request: {
      type: 'IntentRequest',
      requestId: 'request-1',
      timestamp: new Date(now).toISOString(),
      locale: 'ja-JP',
      intent: { name, slots: { taskNumber: { value }, taskContent: { value } } },
    },
  };
}
export function task(id = 'task-1', content = '牛乳'): Task {
  return {
    id,
    content,
    updated_at: '2026-09-12T00:00:00Z',
    due: { date: '2026-09-12', is_recurring: false },
    checked: false,
  };
}
export function mockApi() {
  return {
    list: vi
      .fn()
      .mockResolvedValue({ results: [task(), task('task-2', '資料')], next_cursor: null }),
    get: vi
      .fn()
      .mockImplementation(async (id: string) => task(id, id === 'task-2' ? '資料' : '牛乳')),
    hasChildren: vi.fn().mockResolvedValue(false),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}
