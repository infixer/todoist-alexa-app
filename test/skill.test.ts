import { describe, it, expect } from 'vitest';
import { handleSkill } from '../src/skill';
import { TodoistError } from '../src/todoist';
import { envelope, env, now, task, mockApi } from './helpers';
import type { State } from '../src/types';

async function listed(api = mockApi()) {
  const response = await handleSkill(envelope(), env, api, now);
  return { api, state: response.sessionAttributes!.state };
}
async function pending(action = 'CompleteTaskIntent', number = '2') {
  const { api, state } = await listed();
  const response = await handleSkill(envelope(action, state, number), env, api, now);
  return { api, state: response.sessionAttributes!.state };
}
const speech = (r: Awaited<ReturnType<typeof handleSkill>>) => r.response.outputSpeech?.text;

describe('personal skill', () => {
  it('requires confirmation before adding; adds to Inbox without a due date', async () => {
    const api = mockApi();
    const r = await handleSkill(envelope('AddTaskIntent', undefined, '牛乳'), env, api, now);
    expect(api.execute).not.toHaveBeenCalled();
    expect(speech(r)).toContain('追加しますか');
    await handleSkill(envelope('AMAZON.YesIntent', r.sessionAttributes!.state), env, api, now);
    expect(api.execute.mock.calls[0][0]).toMatchObject({
      type: 'item_add',
      args: { content: '牛乳' },
    });
    expect(api.execute.mock.calls[0][0].args.due).toBeUndefined();
  });
  it('uses the displayed task ID, never a newly fetched list index', async () => {
    const { api, state } = await pending();
    api.list.mockResolvedValue({ results: [task('other')], next_cursor: null });
    const r = await handleSkill(envelope('AMAZON.YesIntent', state), env, api, now);
    expect(api.execute.mock.calls[0][0].args.id).toBe('task-2');
    expect(r.sessionAttributes!.state.view!.items[1].done).toBe(true);
    expect(r.sessionAttributes!.state.view!.items[0].number).toBe(1);
  });
  it('rejects a changed task after confirmation and does not write', async () => {
    const { api, state } = await pending();
    api.get.mockResolvedValue(task('task-2', '変更された内容'));
    const r = await handleSkill(envelope('AMAZON.YesIntent', state), env, api, now);
    expect(speech(r)).toContain('確認中に');
    expect(api.execute).not.toHaveBeenCalled();
  });
  it('new sessions and expired views cannot reuse a number', async () => {
    for (const expired of [false, true]) {
      const { api, state } = await listed();
      const e = envelope('CompleteTaskIntent', state, '2');
      if (expired) state.view!.expiresAt = now - 1;
      else e.session!.new = true;
      const r = await handleSkill(e, env, api, now);
      expect(speech(r)).toContain('新しい一覧');
      expect(api.execute).not.toHaveBeenCalled();
      expect(api.get).not.toHaveBeenCalled();
    }
  });
  it('blocks recurring postponement and parent completion', async () => {
    const { api, state } = await listed();
    api.get.mockResolvedValue({ ...task(), due: { date: '2026-09-12', is_recurring: true } });
    expect(
      speech(await handleSkill(envelope('PostponeTaskIntent', state, '1'), env, api, now)),
    ).toContain('繰り返し');
    api.hasChildren.mockResolvedValue(true);
    expect(
      speech(await handleSkill(envelope('CompleteTaskIntent', state, '1'), env, api, now)),
    ).toContain('子タスク');
    expect(api.execute).not.toHaveBeenCalled();
  });
  it('uses the exact same UUID and command after an unknown outcome', async () => {
    const { api, state } = await pending('PostponeTaskIntent');
    api.execute.mockRejectedValueOnce(new TodoistError('unavailable', true));
    const r = await handleSkill(envelope('AMAZON.YesIntent', state), env, api, now);
    expect(speech(r)).toContain('処理結果を確認できません');
    const frozen = structuredClone(api.execute.mock.calls[0][0]);
    api.get.mockResolvedValue(task('task-2', 'already changed'));
    await handleSkill(
      envelope('AMAZON.YesIntent', r.sessionAttributes!.state),
      env,
      api,
      now + 1000,
    );
    expect(api.execute.mock.calls[1][0]).toEqual(frozen);
  });
  it('replayed signed confirmations share a UUID, including recurring completion', async () => {
    const { api, state } = await pending();
    await handleSkill(envelope('AMAZON.YesIntent', structuredClone(state)), env, api, now);
    await handleSkill(envelope('AMAZON.YesIntent', structuredClone(state)), env, api, now);
    expect(api.execute.mock.calls[0][0].uuid).toEqual(api.execute.mock.calls[1][0].uuid);
  });
  it('expires pending confirmation and accepts cancellation', async () => {
    const { api, state } = await pending();
    expect(
      speech(
        await handleSkill(
          envelope('AMAZON.YesIntent', structuredClone(state)),
          env,
          api,
          now + 61_000,
        ),
      ),
    ).toContain('確認待ち');
    expect(
      (await handleSkill(envelope('AMAZON.NoIntent', state), env, api, now)).sessionAttributes!
        .state.pending,
    ).toBeUndefined();
    expect(api.execute).not.toHaveBeenCalled();
  });
  it('handles LaunchRequest API errors as speech rather than an unhandled rejection', async () => {
    const api = mockApi();
    api.list.mockRejectedValue(new TodoistError('auth'));
    const e = envelope();
    e.request.type = 'LaunchRequest';
    expect(speech(await handleSkill(e, env, api, now))).toContain('接続設定');
  });
  it('appends pagination without renumbering earlier items', async () => {
    const { api, state } = await listed();
    state.view!.nextCursor = 'cursor';
    api.list.mockResolvedValue({ results: [task('3', '三番')], next_cursor: null });
    const r = await handleSkill(envelope('AMAZON.NextIntent', state), env, api, now);
    expect(api.list).toHaveBeenLastCalledWith('cursor');
    expect(r.sessionAttributes!.state.view!.items.map((i) => i.number)).toEqual([1, 2, 3]);
  });
  it('does not render APL on unsupported devices and rejects stale APL events', async () => {
    const { api, state } = await listed();
    const e = envelope('AMAZON.HelpIntent', state);
    expect(
      (await handleSkill(e, { ...env, ENABLE_APL: 'true' }, api, now)).response.directives,
    ).toBeUndefined();
    e.context.System.device.supportedInterfaces['Alexa.Presentation.APL'] = {
      runtime: { maxVersion: '2024.3' },
    };
    expect(
      (await handleSkill(e, { ...env, ENABLE_APL: 'true' }, api, now)).response.directives,
    ).toHaveLength(1);
    e.request = {
      ...e.request,
      type: 'Alexa.Presentation.APL.UserEvent',
      token: 'old',
      arguments: ['complete', 'old', 'task-2'],
    };
    expect(speech(await handleSkill(e, env, api, now))).toContain('古く');
    expect(api.execute).not.toHaveBeenCalled();
  });
  it('refuses a forged task ID in an otherwise current APL event', async () => {
    const { api, state } = await listed();
    const e = envelope('AMAZON.HelpIntent', state);
    e.request = {
      ...e.request,
      type: 'Alexa.Presentation.APL.UserEvent',
      token: state.view!.id,
      arguments: ['complete', state.view!.id, 'not-in-view'],
    };
    expect(speech(await handleSkill(e, env, api, now))).toContain('一覧にありません');
    expect(api.get).not.toHaveBeenCalled();
  });
  it('rejects malformed state and invalid numbers', async () => {
    const e = envelope('CompleteTaskIntent', {} as State, '2');
    expect(speech(await handleSkill(e, env, mockApi(), now))).toContain('新しい一覧');
    expect(
      speech(
        await handleSkill(envelope('CompleteTaskIntent', undefined, '-1'), env, mockApi(), now),
      ),
    ).toContain('百番');
  });
});

it('cancelling an unknown write does not claim to undo Todoist', async () => {
  const { api, state } = await pending();
  api.execute.mockRejectedValueOnce(new TodoistError('unavailable', true));
  const r = await handleSkill(envelope('AMAZON.YesIntent', state), env, api, now);
  const cancelled = await handleSkill(
    envelope('AMAZON.NoIntent', r.sessionAttributes!.state),
    env,
    api,
    now,
  );
  expect(speech(cancelled)).toContain('実行済みの可能性');
});
it('does not replace an uncertain command through an APL refresh', async () => {
  const { api, state } = await pending();
  state.pending!.uncertain = true;
  const e = envelope('AMAZON.HelpIntent', state);
  e.request.type = 'Alexa.Presentation.APL.UserEvent';
  e.request.token = state.view!.id;
  e.request.arguments = ['refresh', state.view!.id];
  const r = await handleSkill(e, env, api, now);
  expect(speech(r)).toContain('未確認');
  expect(r.sessionAttributes!.state.pending!.command.uuid).toBe(state.pending!.command.uuid);
});
it('does not mutate on a missing Yes target and renders supported APL actions through confirmation', async () => {
  const { api, state } = await listed();
  const e = envelope('AMAZON.HelpIntent', state);
  e.request.type = 'Alexa.Presentation.APL.UserEvent';
  e.request.token = state.view!.id;
  e.request.arguments = ['complete', state.view!.id, 'task-2'];
  const r = await handleSkill(e, env, api, now);
  expect(speech(r)).toContain('完了しますか');
  expect(api.execute).not.toHaveBeenCalled();
  api.get.mockRejectedValue(new TodoistError('missing'));
  expect(
    speech(
      await handleSkill(envelope('AMAZON.YesIntent', r.sessionAttributes!.state), env, api, now),
    ),
  ).toContain('現在操作できません');
  expect(api.execute).not.toHaveBeenCalled();
});

it('a rejected new action clears the previous pending confirmation', async () => {
  const { api, state } = await pending();
  const rejected = await handleSkill(envelope('CompleteTaskIntent', state, '0'), env, api, now);
  expect(rejected.sessionAttributes!.state.pending).toBeUndefined();
  await handleSkill(envelope('AMAZON.YesIntent', rejected.sessionAttributes!.state), env, api, now);
  expect(api.execute).not.toHaveBeenCalled();
});
