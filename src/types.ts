import { z } from 'zod';

export interface Env {
  ALEXA_SKILL_ID: string;
  TODOIST_API_TOKEN: string;
  ALLOWED_ALEXA_USER_ID: string;
  ALLOWED_ALEXA_DEVICE_ID?: string;
  ENABLE_APL?: string;
}
export const envelopeSchema = z.object({
  version: z.literal('1.0'),
  session: z
    .object({
      new: z.boolean(),
      sessionId: z.string(),
      application: z.object({ applicationId: z.string() }),
      user: z.object({ userId: z.string() }),
      attributes: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  context: z.object({
    System: z.object({
      application: z.object({ applicationId: z.string() }),
      user: z.object({ userId: z.string() }),
      device: z.object({
        deviceId: z.string(),
        supportedInterfaces: z.record(z.string(), z.unknown()),
      }),
    }),
  }),
  request: z.object({
    type: z.string(),
    requestId: z.string().min(1).max(256),
    timestamp: z.string(),
    locale: z.string().optional(),
    intent: z
      .object({
        name: z.string(),
        slots: z
          .record(z.string(), z.object({ value: z.string().optional() }).passthrough())
          .optional(),
      })
      .optional(),
    token: z.string().optional(),
    arguments: z.array(z.unknown()).optional(),
  }),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export const taskSchema = z.object({
  id: z.string(),
  content: z.string(),
  updated_at: z.string(),
  checked: z.boolean().optional(),
  is_completed: z.boolean().optional(),
  due: z
    .object({
      date: z.string(),
      timezone: z.string().nullable().optional(),
      is_recurring: z.boolean(),
    })
    .nullable(),
});
export type Task = z.infer<typeof taskSchema>;
export const commandSchema = z.object({
  type: z.enum(['item_add', 'item_close', 'item_update']),
  uuid: z.string().uuid(),
  temp_id: z.string().uuid().optional(),
  args: z.record(z.string(), z.unknown()),
});
export type Command = z.infer<typeof commandSchema>;
const itemSchema = z.object({
  number: z.number().int().positive(),
  task: taskSchema,
  done: z.boolean().default(false),
});
export const stateSchema = z.object({
  sessionId: z.string(),
  view: z
    .object({
      id: z.string().uuid(),
      expiresAt: z.number(),
      items: z.array(itemSchema).max(100),
      nextCursor: z.string().nullable(),
    })
    .optional(),
  pending: z
    .object({
      label: z.string(),
      action: z.enum(['add', 'complete', 'postpone']),
      command: commandSchema,
      expiresAt: z.number(),
      taskId: z.string().optional(),
      fingerprint: z.string().optional(),
      number: z.number().optional(),
      uncertain: z.boolean().optional(),
    })
    .optional(),
});
export type State = z.infer<typeof stateSchema>;
export interface SkillResponse {
  version: '1.0';
  sessionAttributes?: { state: State };
  response: {
    outputSpeech?: { type: 'PlainText'; text: string };
    reprompt?: { outputSpeech: { type: 'PlainText'; text: string } };
    shouldEndSession?: boolean;
    directives?: unknown[];
  };
}
