import type { Envelope, State } from './types';

function escapeMarkup(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function renderApl(envelope: Envelope, state: State): unknown[] {
  const apl = envelope.context.System.device.supportedInterfaces['Alexa.Presentation.APL'] as
    { runtime?: { maxVersion?: string } } | undefined;
  if (!state.view || !apl || Number.parseFloat(apl.runtime?.maxVersion ?? '0') < 1.4) return [];
  const view = state.view;
  const button = (label: string, action: string, disabled: unknown = false) => ({
    type: 'TouchWrapper',
    disabled,
    paddingLeft: '8dp',
    paddingRight: '8dp',
    onPress: [{ type: 'SendEvent', arguments: [action, view.id, '${data.id}'] }],
    item: {
      type: 'Frame',
      backgroundColor: '#28455E',
      borderRadius: '8dp',
      padding: '12dp',
      item: { type: 'Text', text: label, color: '#FFFFFF', fontSize: '22dp' },
    },
  });
  return [
    {
      type: 'Alexa.Presentation.APL.RenderDocument',
      token: view.id,
      document: {
        type: 'APL',
        version: '1.4',
        theme: 'dark',
        mainTemplate: {
          parameters: ['payload'],
          items: [
            {
              type: 'Container',
              width: '100vw',
              height: '100vh',
              padding: '16dp',
              items: [
                {
                  type: 'Text',
                  text: state.pending
                    ? escapeMarkup(state.pending.label) + ' はい／いいえで確認'
                    : '今日のやること',
                  fontSize: '24dp',
                  maxLines: 2,
                  color: '#FFFFFF',
                },
                {
                  type: 'Sequence',
                  grow: 1,
                  width: '100%',
                  data: '${payload.tasks}',
                  items: [
                    {
                      type: 'Container',
                      paddingTop: '12dp',
                      paddingBottom: '12dp',
                      items: [
                        {
                          type: 'Text',
                          text: '${data.label}',
                          fontSize: '26dp',
                          maxLines: 2,
                          color: '#FFFFFF',
                        },
                        {
                          type: 'Container',
                          direction: 'row',
                          spacing: '10dp',
                          items: [
                            button('完了', 'complete', '${data.done}'),
                            button('明日へ', 'postpone', '${data.done || data.recurring}'),
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'TouchWrapper',
                  onPress: [{ type: 'SendEvent', arguments: ['refresh', view.id] }],
                  item: { type: 'Text', text: '一覧を更新', fontSize: '22dp', color: '#A8DAFF' },
                },
              ],
            },
          ],
        },
      },
      datasources: {
        tasks: view.items.slice(-5).map((item) => ({
          id: item.task.id,
          label: escapeMarkup(
            `${item.number}. ${item.task.content.slice(0, 120)}${item.done ? '（操作済み）' : ''}`,
          ),
          done: item.done,
          recurring: !!item.task.due?.is_recurring,
        })),
      },
    },
  ];
}
