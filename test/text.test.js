import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize, seniority, extractEmails, htmlToText, toIso, requiredYears, entryHint, workAuth } from '../server/text.js';

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

test('requiredYears reads hard requirements and skips preferred ones', () => {
  assert.equal(requiredYears('Requirements: 5+ years of experience in network administration.'), 5);
  assert.equal(requiredYears('1-2 years of help desk experience. 4+ years preferred.'), 1);
  assert.equal(requiredYears('At least three years experience supporting end users'), 3);
  assert.equal(requiredYears('2+ years in IT support and 6+ years of professional experience'), 6);
  assert.equal(requiredYears('Founded 25 years ago, we serve 10 years of customers.'), null);
  assert.equal(requiredYears('No experience required, we will train you.'), null);
});

test('seniority uses years when the title is silent', () => {
  assert.equal(seniority('IT Support Specialist', { years: 1 }), 'entry');
  assert.equal(seniority('Systems Administrator', { years: 5 }), 'senior');
  assert.equal(seniority('Help Desk Technician', { entryHint: true }), 'entry');
  assert.equal(seniority('Senior Engineer', { years: 1 }), 'senior');
  assert.ok(entryHint('This is an entry-level role for recent graduates.'));
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

test('categorize catches government and school IT titles', () => {
  for (const t of ['IT SYSTEMS TECHNICAL SPECIALIST', '1000 Hour IT Systems Support Technician', 'Technician, IT Support, Field Services', 'COMPUTER USER SUPPORT SPECIALIST I', 'Tier 1 Helpdesk Support (IT Functional Analyst II)', 'Instructional Technology Specialist', 'Technology Technician - Elementary']) {
    assert.ok(['helpdesk', 'it'].includes(categorize(t)), t);
  }
  assert.equal(categorize('Building Automation Systems Technician'), null);
  assert.equal(categorize('Special Education Teacher'), null);
});

test('workAuth flags citizenship, clearance and sponsorship requirements', () => {
  assert.deepEqual(workAuth('Must be a U.S. citizen to be considered.'), { citizenOnly: true, clearance: false, noSponsorship: false });
  assert.equal(workAuth('Ability to obtain a Secret clearance.').clearance, true);
  assert.equal(workAuth('We are unable to provide visa sponsorship for this role.').noSponsorship, true);
  assert.equal(workAuth('Candidates must be authorized to work in the United States.').citizenOnly, false);
  assert.equal(workAuth('', 'U.S. Citizenship is Required').citizenOnly, true);
  assert.equal(workAuth('', 'Does Not Offer Sponsorship').noSponsorship, true);
});

test('categorize skips trades and office roles that borrow tech words', () => {
  for (const t of ['Security Supervisor- Lieutenant (Transportation)', 'Administrative Support Technician III, Records Evening', 'Engineering Support Technician I - Public Works, Engineering', 'Electronics Technician II – Building Security Services', 'Engineer I, II & III (Proficiency Advancement)', 'Building Automation System Programmer', 'Sr. Fire Alarm Technician']) {
    assert.equal(categorize(t), null, t);
  }
  assert.equal(categorize('IT Support Technician - Facilities Department'), 'helpdesk');
  assert.equal(categorize('Cyber Security Analyst I'), 'security');
});
