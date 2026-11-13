import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guard } from '../server/gemini.js';

const kit = () => ({
  recruiterEmailBody: 'Hi team,\n\nI would love to talk about the role.\n\nBest regards,\nAlex Rivera',
  screeningAnswers: [
    { question: 'Are you legally authorized to work in the United States?', answer: 'Yes, I am.' },
    { question: 'Why this company?', answer: 'Because of the mission.' },
    { question: 'Are you willing to relocate?', answer: 'Yes.' },
  ],
});

test('guard blanks personal answers the resume does not support', () => {
  const k = guard(kit(), 'IT Support Specialist. Skills: Windows.');
  assert.match(k.screeningAnswers[0].answer, /Answer this one yourself/);
  assert.equal(k.screeningAnswers[1].answer, 'Because of the mission.');
  assert.match(k.screeningAnswers[2].answer, /Answer this one yourself/);
});

test('guard keeps personal answers the resume or notes state', () => {
  const k = guard(kit(), 'US citizen. Open to relocating to Austin.');
  assert.equal(k.screeningAnswers[0].answer, 'Yes, I am.');
  assert.equal(k.screeningAnswers[2].answer, 'Yes.');
});

test('guard strips the sign-off so the app signature is not doubled', () => {
  assert.equal(guard(kit(), '').recruiterEmailBody, 'Hi team,\n\nI would love to talk about the role.');
});
