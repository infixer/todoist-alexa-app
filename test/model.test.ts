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

it('separates slot references from Japanese text and references declared slots', () => {
  for (const intent of model.interactionModel.languageModel.intents) {
    const names = new Set(('slots' in intent ? intent.slots : [])?.map((slot) => slot.name));
    const referenced = new Set<string>();
    for (const sample of intent.samples) {
      for (const match of sample.matchAll(/\{([^}]+)\}/g)) {
        expect(names.has(match[1])).toBe(true);
        const start = match.index!;
        const end = start + match[0].length;
        expect(start === 0 || sample[start - 1] === ' ').toBe(true);
        expect(end === sample.length || sample[end] === ' ').toBe(true);
        referenced.add(match[1]);
      }
    }
    for (const name of names) expect(referenced.has(name)).toBe(true);
  }
});
