// Growth plan: what to build and which certifications to get for the roles the user wants,
// grounded in what matching postings actually ask for.
import { generateAI } from './ai.js';

const STR = { type: 'STRING' };
const LIST = { type: 'ARRAY', items: STR };

export const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    readiness: { type: 'INTEGER', description: '0-100: how ready the resume is today for the target roles' },
    summary: STR,
    projects: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: STR, why: STR, demonstrates: LIST, steps: LIST, deliverable: STR,
          resumeBullet: STR, time: STR, cost: STR, difficulty: STR,
        },
        required: ['title', 'why', 'demonstrates', 'steps', 'deliverable', 'resumeBullet', 'time', 'cost', 'difficulty'],
      },
    },
    certifications: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: STR, issuer: STR, why: STR, unlocks: STR, prerequisites: STR, studyTime: STR, cost: STR, priority: { type: 'INTEGER' }, studyPlan: LIST,
        },
        required: ['name', 'issuer', 'why', 'unlocks', 'prerequisites', 'studyTime', 'cost', 'priority', 'studyPlan'],
      },
    },
    quickWins: LIST,
    skipForNow: LIST,
  },
  required: ['readiness', 'summary', 'projects', 'certifications', 'quickWins', 'skipForNow'],
};

const clip = (s, n) => String(s || '').slice(0, n);

export function buildPlanPrompt({ resumeText, targets, demand }) {
  const skills = (demand?.skills || []).slice(0, 25).map((s) => `- ${s.skill}: in ${s.count} of ${demand.total} postings${s.inResume ? ' (already on resume)' : ' (NOT on resume)'}`).join('\n');
  const certs = (demand?.certs || []).slice(0, 15).map((c) => `- ${c.name}: mentioned in ${c.count} postings${c.inResume ? ' (candidate already lists it)' : ''}`).join('\n');
  const titles = (demand?.titles || []).slice(0, 15).map((t) => `- ${t}`).join('\n');
  return `You are a career coach for people breaking into ${clip(targets.roles, 200) || 'a career of their choice'}. Build a concrete growth plan for this candidate.

TARGET
Roles: ${clip(targets.roles, 200) || 'any career field'}
Level: ${clip(targets.level, 80) || 'entry level'}
Location: ${clip(targets.location, 120) || 'not given'}
${targets.workAuth ? `${clip(targets.workAuth, 400)}\n` : ''}
WHAT MATCHING JOB POSTINGS ASK FOR (counted from ${demand?.total || 0} current postings for these roles)
Skills:
${skills || '- (no data)'}
Certifications mentioned:
${certs || '- (none mentioned)'}
Example titles:
${titles || '- (none)'}

RULES
- Be specific to the target roles, field and level. Recommend realistic, affordable ways to demonstrate skills that fit the profession: coursework, supervised labs, simulations, case studies, or a portfolio when appropriate.
- Projects: 3 to 5. Each must prove one or more skills that postings ask for and the resume lacks. Give 4 to 7 concrete steps each, name suitable tools or resources, say what to show an employer, and write the resume bullet the candidate could honestly add AFTER finishing it.
- Respect professional boundaries: never suggest unsupervised clinical practice, handling real patient information, or claiming a license or credential the candidate does not have. Use simulations and public, de-identified data for healthcare examples; flag licensure and safety requirements for the relevant official authority. For engineering, emphasize safety and supervised work where applicable.
- Certifications: 2 to 4, ordered by priority (1 = first). Justify each with the posting counts above where possible. Say what it unlocks (which kinds of postings). Give approximate cost and study time from general knowledge and say "check the current price" in the cost field. Include a short study plan (3 to 6 steps, prefer free resources like Professor Messer for CompTIA, Microsoft Learn for Microsoft exams).
- Do not recommend anything that requires a security clearance or US citizenship unless the candidate is a US citizen.
- quickWins: 3 to 5 resume or LinkedIn improvements. Rewording, reordering, adding metrics or links for things the resume already shows is fine. Anything the resume does NOT show must be phrased as a question, e.g. "If you have upgraded RAM or SSDs, add a bullet saying so" - never tell the candidate to add a task they may not have done.
- skipForNow: 2 to 4 things that look tempting but aren't worth it yet for these roles, and why.
- Never invent experience. The readiness score must be honest.

CANDIDATE RESUME
${clip(resumeText, 16000)}`;
}

export function makePlan({ provider = 'gemini', apiKey, model, resumeText, targets, demand }) {
  return generateAI({
    provider, apiKey, model, label: 'plan', schema: PLAN_SCHEMA, temperature: 0.4,
    prompt: buildPlanPrompt({ resumeText, targets: targets || {}, demand: demand || {} }),
    post: (p) => ({
      ...p,
      readiness: Math.max(0, Math.min(100, Math.round(Number(p.readiness) || 0))),
      certifications: [...(p.certifications || [])].sort((a, b) => (a.priority || 9) - (b.priority || 9)),
    }),
  });
}
