import { v5 as uuid } from 'uuid';
import {
  stateSchema,
  type Envelope,
  type State,
  type Task,
  type SkillResponse,
  type Env,
} from './types';
import type { TaskService } from './todoist';
import { TodoistError } from './todoist';
import { postponedDate, tomorrow } from './date';
import { renderApl } from './apl';

const namespace = '20fa4c7b-8e85-4b8e-a7e2-7b8c4288d476';
const help = '牛乳を追加、今日の一覧、二番を完了、二番を明日に延期、と言ってください。';
const title = (task: Task) => task.content.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160);
export const fingerprint = (task: Task) =>
  JSON.stringify([
    task.id,
    task.updated_at,
    task.content,
    task.due,
    task.checked,
    task.is_completed,
  ]);

export async function handleSkill(
  e: Envelope,
  env: Env,
  api: TaskService,
  now = Date.now(),
): Promise<SkillResponse> {
  const loaded = stateSchema.safeParse(e.session?.attributes?.state);
  const sessionId = e.session?.sessionId ?? '';
  const state: State =
    !e.session?.new && loaded.success && loaded.data.sessionId === sessionId
      ? loaded.data
      : { sessionId };
  if (state.view && state.view.expiresAt <= now) delete state.view;
  if (state.pending && state.pending.expiresAt <= now) delete state.pending;
  function respond(text: string, end = false): SkillResponse {
    const directives = !end && env.ENABLE_APL === 'true' ? renderApl(e, state) : [];
    return {
      version: '1.0',
      sessionAttributes: { state },
      response: {
        outputSpeech: { type: 'PlainText', text },
        shouldEndSession: end,
        ...(!end
          ? {
              reprompt: {
                outputSpeech: {
                  type: 'PlainText' as const,
                  text: state.pending
                    ? 'はい、または、いいえ、と言ってください。'
                    : '操作する番号を指定するか、終了、と言ってください。',
                },
              },
            }
          : {}),
        ...(directives.length ? { directives } : {}),
      },
    };
  }
  async function list(next = false, prefix = '') {
    delete state.pending;
    if (next && !state.view?.nextCursor)
      return respond('続きはありません。今日の一覧、と言うと更新できます。');
    if (next && state.view!.items.length >= 100)
      return respond('一度に扱えるのは百件までです。残りはTodoistで確認してください。');
    const page = await api.list(next ? (state.view?.nextCursor ?? undefined) : undefined);
    const old = next ? state.view!.items : [];
    const seen = new Set(old.map((item) => item.task.id));
    const items = page.results
      .filter((task) => !seen.has(task.id))
      .map((task, i) => ({ number: old.length + i + 1, task, done: false }));
    const view = {
      id: next ? state.view!.id : crypto.randomUUID(),
      expiresAt: next ? state.view!.expiresAt : now + 300_000,
      items: [...old, ...items],
      nextCursor: page.next_cursor,
    };
    // Leave headroom for Alexa's response envelope, speech and APL document.
    if (new TextEncoder().encode(JSON.stringify(view)).length > 60_000) {
      if (state.view) state.view.nextCursor = null;
      return respond(
        '一覧が大きいため、この会話での追加読み込みを止めました。残りはTodoistで確認してください。',
      );
    }
    state.view = view;
    delete state.pending;
    const speech = items.map((item) => `${item.number}番、${title(item.task)}。`).join('');
    return respond(
      prefix +
        (speech ||
          (next ? 'このページに新しい項目はありません。' : '今日が期限のタスクはありません。')) +
        (page.next_cursor ? '続き、と言うと次を読みます。' : '') +
        (state.view.items.length ? '番号で完了か延期を指定できます。' : ''),
    );
  }
  async function select(action: 'complete' | 'postpone', number: number) {
    delete state.pending;
    if (!state.view)
      return await list(false, '前の番号は有効ではありません。新しい一覧から指定してください。');
    const item = state.view.items.find((item) => item.number === number);
    if (!item) return respond('その番号は一覧にありません。読み上げた番号で指定してください。');
    if (item.done) return respond('その番号は操作済みです。今日の一覧、と言うと更新できます。');
    const task = await api.get(item.task.id);
    if (task.checked || task.is_completed)
      return respond('そのタスクは完了済みです。一覧を更新してください。');
    if (action === 'postpone' && task.due?.is_recurring)
      return respond('繰り返しタスクの延期にはまだ対応していません。Todoistで変更してください。');
    // The MVP avoids unexpectedly completing children, including children outside today's view.
    if (action === 'complete' && (await api.hasChildren(task.id)))
      return respond('子タスクのあるタスクは、Todoistで完了してください。');
    const changed = fingerprint(task) !== fingerprint(item.task);
    item.task = task;
    const date = action === 'postpone' ? postponedDate(task.due?.date, now) : '';
    const label =
      action === 'complete'
        ? `${number}番の「${title(task)}」${task.due?.is_recurring ? 'の今回分' : ''}を完了しますか。`
        : `${number}番の「${title(task)}」を明日${tomorrow(now)}${date.includes('T') ? 'の同じ時刻' : ''}に延期しますか。`;
    state.pending = {
      action,
      label,
      taskId: task.id,
      fingerprint: fingerprint(task),
      number,
      expiresAt: now + 60_000,
      command: {
        type: action === 'complete' ? 'item_close' : 'item_update',
        uuid: uuid(`${state.view.id}:${task.id}:${action}`, namespace),
        args: action === 'complete' ? { id: task.id } : { id: task.id, due: { date } },
      },
    };
    return respond((changed ? '一覧の時点から内容が変わっています。' : '') + label);
  }
  let retryingUncertain = false;
  try {
    const type = e.request.type;
    if (type === 'SessionEndedRequest' || type === 'Alexa.Presentation.APL.RuntimeError')
      return { version: '1.0', response: {} };
    if (!e.session) return respond('やること相棒を開いてから操作してください。', true);
    const name = e.request.intent?.name;
    if (
      state.pending?.uncertain &&
      !['AMAZON.YesIntent', 'AMAZON.NoIntent', 'AMAZON.StopIntent', 'AMAZON.CancelIntent'].includes(
        name ?? '',
      )
    ) {
      return respond('直前の操作結果が未確認です。はい、と言うと同じ操作を再確認します。');
    }
    if (type === 'LaunchRequest') return await list();
    if (type === 'Alexa.Presentation.APL.UserEvent') {
      const [action, viewId, taskId] = e.request.arguments ?? [];
      if (!state.view || e.request.token !== state.view.id || viewId !== state.view.id)
        return await list(
          false,
          '画面が古くなりました。一覧を更新します。もう一度操作してください。',
        );
      if (action === 'refresh') return await list();
      if ((action !== 'complete' && action !== 'postpone') || typeof taskId !== 'string')
        return respond(help);
      const item = state.view.items.find((item) => item.task.id === taskId);
      if (!item) return respond('そのタスクは現在の一覧にありません。');
      return await select(action, item.number);
    }
    if (type !== 'IntentRequest') return respond(help);
    const intent = e.request.intent;
    if (!intent) return respond(help);
    if (['AMAZON.StopIntent', 'AMAZON.CancelIntent'].includes(intent.name)) {
      delete state.pending;
      return respond('終了します。', true);
    }
    if (intent.name === 'AMAZON.NoIntent') {
      const unknown = state.pending?.uncertain;
      delete state.pending;
      return respond(
        unknown
          ? '再確認を中止しました。Todoist側では実行済みの可能性があるため、アプリで確認してください。'
          : '取り消しました。',
      );
    }
    if (intent.name === 'AMAZON.YesIntent') {
      const pending = state.pending;
      if (!pending) return respond('確認待ちの操作はありません。' + help);
      if (pending.taskId && !pending.uncertain) {
        const current = await api.get(pending.taskId);
        if (fingerprint(current) !== pending.fingerprint) {
          delete state.pending;
          return respond('確認中にタスクが変わりました。番号をもう一度指定してください。');
        }
        if (pending.action === 'complete' && (await api.hasChildren(pending.taskId))) {
          delete state.pending;
          return respond('子タスクがあるため、Todoistで完了してください。');
        }
      }
      // Keep the frozen command + UUID on unknown outcomes; only explicit Yes retries it.
      retryingUncertain = !!pending.uncertain;
      pending.uncertain = true;
      await api.execute(pending.command);
      const item = state.view?.items.find((item) => item.task.id === pending.taskId);
      if (item) item.done = true;
      const text =
        pending.action === 'add'
          ? '追加しました。期限は設定していません。'
          : pending.action === 'complete'
            ? '完了しました。'
            : '明日に延期しました。';
      delete state.pending;
      return respond(text);
    }
    if (intent.name === 'ListTodayIntent') return await list();
    if (intent.name === 'AMAZON.NextIntent') return await list(true);
    if (intent.name === 'AddTaskIntent') {
      delete state.pending;
      const content = intent.slots?.taskContent?.value?.trim();
      if (!content || content.length > 200 || /[\u0000-\u001f]/.test(content))
        return respond('追加する内容を二百文字以内で、牛乳を追加、のように言ってください。');
      state.pending = {
        action: 'add',
        label: `「${content}」を期限なしで追加しますか。`,
        expiresAt: now + 60_000,
        command: {
          type: 'item_add',
          uuid: uuid(`${e.request.requestId}:add`, namespace),
          temp_id: uuid(`${e.request.requestId}:temp`, namespace),
          args: { content },
        },
      };
      return respond(state.pending.label);
    }
    if (intent.name === 'CompleteTaskIntent' || intent.name === 'PostponeTaskIntent') {
      delete state.pending;
      const value = intent.slots?.taskNumber?.value ?? '';
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100)
        return respond('一番から百番までの番号で指定してください。');
      delete state.pending;
      return await select(
        intent.name === 'CompleteTaskIntent' ? 'complete' : 'postpone',
        Number(value),
      );
    }
    return respond(help);
  } catch (error) {
    if (error instanceof TodoistError) {
      if (error.uncertain && state.pending) {
        state.pending.uncertain = true;
        return respond(
          '処理結果を確認できませんでした。はい、と言うと同じ操作を再確認します。言い直して追加すると重複する可能性があります。',
        );
      }
      if (!retryingUncertain) delete state.pending;
      return respond(
        {
          auth: 'Todoistの接続設定を確認してください。',
          rate: '少し時間をおいて、もう一度お願いします。',
          missing: 'そのタスクは現在操作できません。一覧を更新してください。',
          unavailable: 'Todoistに接続できませんでした。少し時間をおいてください。',
          invalid: 'Todoistが操作を受け付けませんでした。アプリで確認してください。',
        }[error.code],
      );
    }
    // No exception text, request bodies, task titles or credentials enter logs.
    return respond('処理を続けられませんでした。Todoistで状態を確認してください。');
  }
}
