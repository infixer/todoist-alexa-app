import { AlexaVerifier, authorize } from './security';
import { readLimited } from './http';
import { handleSkill } from './skill';
import { TodoistClient } from './todoist';
import type { Env } from './types';

const verifier = new AlexaVerifier();
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now();
    if (new URL(request.url).pathname !== '/alexa')
      return new Response('Not found', { status: 404 });
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    if (
      request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    )
      return new Response('Unsupported media type', { status: 415 });
    if (!env.ALEXA_SKILL_ID || !env.ALLOWED_ALEXA_USER_ID || !env.TODOIST_API_TOKEN)
      return new Response('Service not configured', { status: 503 });
    let envelope;
    try {
      const raw = await readLimited(request, 128_000);
      envelope = await verifier.verify(request.headers, raw);
      authorize(envelope, env);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const remaining = 6000 - (Date.now() - started);
    if (remaining <= 0)
      return Response.json({
        version: '1.0',
        response: {
          outputSpeech: { type: 'PlainText', text: '時間がかかっています。もう一度お願いします。' },
          shouldEndSession: true,
        },
      });
    const api = new TodoistClient(env.TODOIST_API_TOKEN, AbortSignal.timeout(remaining));
    return Response.json(await handleSkill(envelope, env, api), {
      headers: { 'Cache-Control': 'no-store' },
    });
  },
};
