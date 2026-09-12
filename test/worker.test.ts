import { expect, it } from 'vitest';
import worker from '../src/index';
import { env } from './helpers';
it('fails closed when configuration is missing', async () => {
  const r = await worker.fetch(
    new Request('https://example.com/alexa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    { ...env, TODOIST_API_TOKEN: '' },
  );
  expect(r.status).toBe(503);
});
it('rejects unsigned requests with all credentials configured', async () => {
  const r = await worker.fetch(
    new Request('https://example.com/alexa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    env,
  );
  expect(r.status).toBe(400);
  expect(await r.text()).not.toContain('test-token');
});
it('limits routes, methods and media types', async () => {
  expect((await worker.fetch(new Request('https://example.com/'), env)).status).toBe(404);
  expect((await worker.fetch(new Request('https://example.com/alexa'), env)).status).toBe(405);
  expect(
    (
      await worker.fetch(
        new Request('https://example.com/alexa', { method: 'POST', body: '{}' }),
        env,
      )
    ).status,
  ).toBe(415);
});
