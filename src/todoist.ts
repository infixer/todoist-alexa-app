import { z } from 'zod';
import { readLimited } from './http';
import { taskSchema, type Task, type Command } from './types';

export class TodoistError extends Error {
  constructor(
    public readonly code: 'auth' | 'rate' | 'missing' | 'unavailable' | 'invalid',
    public readonly uncertain = false,
  ) {
    super(code);
  }
}
export interface TaskService {
  list(cursor?: string): Promise<{ results: Task[]; next_cursor: string | null }>;
  get(id: string): Promise<Task>;
  hasChildren(id: string): Promise<boolean>;
  execute(command: Command): Promise<void>;
}
export class TodoistClient implements TaskService {
  constructor(
    private readonly token: string,
    private readonly signal: AbortSignal,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private async call(path: string, command?: Command): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.todoist.com/api/v1${path}`, {
        method: command ? 'POST' : 'GET',
        redirect: 'error',
        signal: this.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(command ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: command ? new URLSearchParams({ commands: JSON.stringify([command]) }) : undefined,
      });
    } catch {
      throw new TodoistError('unavailable', !!command);
    }
    if (response.status === 401 || response.status === 403) throw new TodoistError('auth');
    if (response.status === 429) throw new TodoistError('rate');
    if (response.status === 404) throw new TodoistError('missing');
    if (!response.ok)
      throw new TodoistError(
        response.status >= 500 ? 'unavailable' : 'invalid',
        !!command && response.status >= 500,
      );
    try {
      return JSON.parse(new TextDecoder().decode(await readLimited(response, 512_000)));
    } catch {
      throw new TodoistError('unavailable', !!command);
    }
  }
  async list(cursor?: string) {
    const query = new URLSearchParams({ query: 'today', lang: 'en', limit: '5' });
    if (cursor) query.set('cursor', cursor);
    return z
      .object({ results: z.array(taskSchema), next_cursor: z.string().nullable() })
      .parse(await this.call(`/tasks/filter?${query}`));
  }
  async get(id: string): Promise<Task> {
    return taskSchema.parse(await this.call(`/tasks/${encodeURIComponent(id)}`));
  }
  async hasChildren(id: string): Promise<boolean> {
    const query = new URLSearchParams({ parent_id: id, limit: '1' });
    const page = z
      .object({ results: z.array(z.unknown()) })
      .parse(await this.call(`/tasks?${query}`));
    return page.results.length > 0;
  }
  async execute(command: Command): Promise<void> {
    const result = await this.call('/sync', command);
    const parsed = z.object({ sync_status: z.record(z.string(), z.unknown()) }).safeParse(result);
    if (!parsed.success || parsed.data.sync_status[command.uuid] === undefined)
      throw new TodoistError('unavailable', true);
    const status = parsed.data.sync_status[command.uuid];
    if (status !== 'ok') throw new TodoistError('invalid');
  }
}
