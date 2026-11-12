import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, seniority, extractEmails, htmlToText, toIso } from '../server/text.js';

test('categorize sorts tech titles into the right bucket', () => {
  assert.equal(categorize('Service Desk Engineer'), 'helpdesk');
  assert.equal(categorize('IT Support Specialist'), 'helpdesk');
  assert.equal(categorize('Help Desk Technician Tier 1'), 'helpdesk');
  assert.equal(categorize('Systems Administrator'), 'it');
  assert.equal(categorize('Senior Software Engineer'), 'swe');
  assert.equal(categorize('Full-Stack Developer (React/Node)'), 'swe');
  assert.equal(categorize('Site Reliability Engineer'), 'devops');
  assert.equal(categorize('SOC Analyst II'), 'security');
  assert.equal(categorize('Software Development Engineer in Test II'), 'qa');
  assert.equal(categorize('Data Engineer'), 'data');
});

test('categorize skips non-tech roles', () => {
  assert.equal(categorize('Patient Support Specialist'), null);
  assert.equal(categorize('Account Executive, FedCiv'), null);
  assert.equal(categorize('Executive Assistant'), null);
});

test('seniority', () => {
  assert.equal(seniority('Junior Help Desk Analyst'), 'entry');
  assert.equal(seniority('Senior DevOps Engineer'), 'senior');
  assert.equal(seniority('Software Engineering Intern'), 'intern');
  assert.equal(seniority('Werkstudent Softwareentwicklung'), 'intern');
  assert.equal(seniority('Backend Engineer'), 'mid');
});

test('extractEmails keeps recruiter addresses and drops noise', () => {
  const text = 'Send your CV to jobs@acme.io. Questions: privacy@acme.io or noreply@acme.io. Talent: Jane.Doe@Acme.io.';
  assert.deepEqual(extractEmails(text), ['jobs@acme.io', 'jane.doe@acme.io']);
});

test('htmlToText handles double-encoded HTML and lists', () => {
  assert.equal(htmlToText('&lt;p&gt;Hi &amp;amp; bye&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;'), 'Hi & bye\n\n- One');
});

test('toIso treats zone-less timestamps as UTC and accepts unix seconds', () => {
  assert.equal(toIso('2026-11-10T14:25:05'), '2026-11-10T14:25:05.000Z');
  assert.equal(toIso(1794384008), new Date(1794384008 * 1000).toISOString());
  assert.equal(toIso('garbage'), null);
});
