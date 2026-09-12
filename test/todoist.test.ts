import { expect, it, vi } from 'vitest';
import { TodoistClient } from '../src/todoist';
import type { Command } from '../src/types';
import { task } from './helpers';
const command: Command = {
  type: 'item_add',
  uuid: '23752a28-6e84-428a-a294-ef2fb07510d7',
  args: { content: '牛乳' },
};
it('uses v1 cursor pagination and Bearer auth', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ results: [task()], next_cursor: 'next' }));
  const api = new TodoistClient('test-only', AbortSignal.timeout(1000), fetcher);
  expect((await api.list('abc')).next_cursor).toBe('next');
  expect(fetcher.mock.calls[0][0]).toContain(
    '/api/v1/tasks/filter?query=today&lang=en&limit=5&cursor=abc',
  );
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-only');
});
it('checks command-level errors inside HTTP 200', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ sync_status: { [command.uuid]: { http_code: 400 } } }));
  await expect(
    new TodoistClient('test', AbortSignal.timeout(1000), fetcher).execute(command),
  ).rejects.toMatchObject({ code: 'invalid' });
});
it('marks lost write responses uncertain but never automatically retries', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('timeout'));
  await expect(
    new TodoistClient('test', AbortSignal.timeout(1000), fetcher).execute(command),
  ).rejects.toMatchObject({ uncertain: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('distinguishes rate limits and authentication errors', async () => {
  for (const [status, code] of [
    [429, 'rate'],
    [401, 'auth'],
    [404, 'missing'],
  ] as const) {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status }));
    await expect(
      new TodoistClient('test', AbortSignal.timeout(1000), fetcher).list(),
    ).rejects.toMatchObject({ code });
  }
});
