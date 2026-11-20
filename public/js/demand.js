// What matching postings ask for: skills and certifications, counted locally (no AI, no network).
import { SKILL_RES } from './filters.js';

export const CERTS = [
  ['CompTIA A+', /(^|[^a-z0-9])a\+(?![a-z0-9])/i],
  ['CompTIA Network+', /network\+/i],
  ['CompTIA Security+', /security\+/i],
  ['CompTIA Linux+', /linux\+/i],
  ['CompTIA Server+', /server\+/i],
  ['CompTIA Cloud+', /cloud\+/i],
  ['CompTIA CySA+', /cysa\+/i],
  ['CompTIA Tech+ / ITF+', /(tech\+|itf\+|comptia it fundamentals)/i],
  ['Cisco CCNA', /\bccna\b/i],
  ['Cisco CCST', /\bccst\b/i],
  ['ITIL 4 Foundation', /\bitil\b/i],
  ['Google IT Support Certificate', /google it support/i],
  ['Microsoft 365 (MS-900 / MD-102)', /\b(ms-900|md-102|ms-102|md-100|microsoft 365 certified|modern desktop administrator)\b/i],
  ['Microsoft Azure (AZ-900 / AZ-104)', /\b(az-900|az-104|azure administrator|azure fundamentals)\b/i],
  ['Microsoft Security (SC-900 / SC-200)', /\b(sc-900|sc-200|sc-300)\b/i],
  ['AWS Certified', /\b(aws certified|cloud practitioner|solutions architect associate)\b/i],
  ['Jamf Certified', /\bjamf (100|170|200|certified)/i],
  ['Apple ACSP', /\b(acsp|apple certified support professional)\b/i],
  ['HDI Support Center Analyst', /\bhdi\b/i],
  ['CISSP', /\bcissp\b/i],
  ['CPA', /\bcertified public accountant\b|\bCPA\b/i],
  ['CMA', /\bcertified management accountant\b|\bCMA\b/i],
  ['CFA', /\bchartered financial analyst\b|\bCFA\b/i],
  ['PMP', /\bproject management professional\b|\bPMP\b/i],
  ['SHRM-CP / SHRM-SCP', /\bSHRM-(CP|SCP)\b|\bSHRM certified\b/i],
  ['Professional Engineer (PE)', /\bprofessional engineer\b|\bPE license\b/i],
  ['Six Sigma', /\bsix sigma\b/i],
  ['OSHA 10 / 30', /\bOSHA[- ]?(10|30)\b/i],
  ['BLS / CPR', /\b(BLS|CPR) certification\b/i],
  ['RN license / NCLEX', /\b(NCLEX|registered nurse license|RN license)\b/i],
];

export function demandFor(jobs, resumeText = '') {
  const skillCount = new Map(), certCount = new Map();
  let withText = 0;
  for (const j of jobs) {
    const hay = `${j.title}\n${j.description || ''}`;
    if ((j.description || '').length > 300) withText++;
    for (const [s, re] of SKILL_RES) if (re.test(hay)) skillCount.set(s, (skillCount.get(s) || 0) + 1);
    for (const [name, re] of CERTS) if (re.test(hay)) certCount.set(name, (certCount.get(name) || 0) + 1);
  }
  const has = (re) => re.test(resumeText);
  const skills = [...skillCount].map(([skill, count]) => ({ skill, count, inResume: has(SKILL_RES.find(([s]) => s === skill)[1]) }))
    .sort((a, b) => b.count - a.count).slice(0, 25);
  const certs = [...certCount].map(([name, count]) => ({ name, count, inResume: has(CERTS.find(([n]) => n === name)[1]) }))
    .sort((a, b) => b.count - a.count);
  return { total: jobs.length, withText, skills, certs, titles: [...new Set(jobs.map((j) => j.title))].slice(0, 15) };
}
