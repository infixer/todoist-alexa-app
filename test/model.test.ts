import { expect, it } from 'vitest';
import model from '../skill-package/interactionModels/custom/ja-JP.json';
it('provides the four Japanese intents and only one SearchQuery slot per utterance', () => {
  const language = model.interactionModel.languageModel;
  expect(language.invocationName).toBe('やること相棒');
  expect(language.intents.map((i) => i.name)).toEqual(
    expect.arrayContaining([
      'AddTaskIntent',
      'ListTodayIntent',
      'CompleteTaskIntent',
      'PostponeTaskIntent',
    ]),
  );
  const add = language.intents.find((i) => i.name === 'AddTaskIntent')!;
  for (const sample of add.samples) {
    expect(sample.match(/\{[^}]+\}/g)).toEqual(['{taskContent}']);
    expect(sample.replace('{taskContent}', '').length).toBeGreaterThan(0);
  }
});
