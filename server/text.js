// Pure helpers: HTML to text, role categorizing, email extraction, freshness.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '...', mdash: '-', ndash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', bull: '*' };

export function decodeEntities(s = '') {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html = '') {
  let s = String(html);
  // Some feeds (Greenhouse, RSS) double-encode their HTML.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.replace(/[ \t\u00a0]+/g, ' ')
    // "<li><p>Text</p></li>" would leave the bullet alone on its own line.
    .replace(/\n- *\n+\s*/g, '\n- ')
    .replace(/(?<=\n- [^\n]*)\n\s*\n+(?=- )/g, '\n')
    .replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

// Order matters: first match wins, so specific roles come before broad ones.
export const CATEGORIES = [
  { id: 'helpdesk', label: 'Helpdesk & Support', re: /\b(help ?desk|service ?desk|desktop support|tech(nical)? support|it support|support (technician|engineer)|(it|technical|desktop|application|systems?|computer|user|technology) support (specialist|analyst|technician|associate)|computer user support|end[- ]user support|field (service )?tech(nician)?|tier ?(1|2|i|ii)\b|deskside|it (technician|tech|aide)\b|computer (technician|specialist|operator)|technology (technician|specialist|assistant|aide)|instructional technology (specialist|technician)|school technology|it (associate|apprentice))/i },
  { id: 'security', label: 'Security', re: /\b(cyber|information security|it security|network security|cloud security|application security|security (analyst|engineer|operations|architect|administrator|specialist)|soc analyst|penetration|pentest|infosec|grc analyst|iam engineer)/i },
  { id: 'devops', label: 'DevOps & Cloud', re: /\b(devops|dev ops|sre\b|site reliability|cloud (engineer|architect|ops)|platform engineer|infrastructure engineer|kubernetes|devsecops)/i },
  { id: 'it', label: 'IT & Sysadmin', re: /\b(sys(tems)? ?admin|system administrator|systems engineer|network (engineer|administrator|technician|analyst|specialist)|it (specialist|administrator|analyst|manager|engineer|coordinator|operations)|\bit (systems?|functional|programmer|infrastructure|network|technical)\b[a-z ,/-]{0,30}(specialist|analyst|technician|engineer|administrator|coordinator)|(?<!automation )(?<!alarm )systems? (specialist|analyst)|m365|microsoft 365|intune|active directory|noc (engineer|technician|analyst)|information technology)/i },
  { id: 'data', label: 'Data & ML', re: /\b(data (engineer|analyst|scientist)|machine learning|ml engineer|ai engineer|analytics engineer|bi (developer|analyst)|mlops|database administrator|\bdba\b)/i },
  { id: 'qa', label: 'QA & Test', re: /\b(qa\b|quality assurance|test (engineer|automation|analyst)|engineer in test|sdet|automation tester|software tester)/i },
  { id: 'swe', label: 'Software Engineering', re: /\b(software|developer|programmer|front[- ]?end|back[- ]?end|full[- ]?stack|web dev|ios|android|mobile (engineer|developer)|swe\b|sde\b|golang|python engineer|java engineer|\.net|react|node(\.js)? engineer|firmware|embedded)/i },
];

const CAREER_CATEGORIES = [
  { id: 'nursing', re: /\b(nurs(e|ing)|registered nurse|rn\b|lpn\b|lvn\b|nurse practitioner|midwife|midwives|clinical nurse|nurse anesthetist)\b/i },
  { id: 'residency', re: /\b(medical|physician|pharmacy|clinical) (resident|residency|fellow|fellowship)\b|\b(resident physician|physician resident|medical residency|gme resident|residency program|fellowship program)\b/i },
  { id: 'pharmacy-tech', re: /\b(pharmacy technician|pharmacy tech|pharmacy assistant|pharmacy aide)\b/i },
  { id: 'pharmacy', re: /\b(pharmacist|pharmacy intern|pharmacy associate|clinical pharmacist|pharmacy manager)\b/i },
  { id: 'hospital-data-entry', re: /\b(hospital|medical|healthcare|health care) (data entry|data-entry|data clerk)\b|\bdata entry (clerk|specialist|operator) (at|for) (a )?(hospital|clinic|medical|healthcare)\b|\b(medical|health) records (clerk|technician|assistant)\b/i },
  { id: 'clinical-research', re: /\bclinical research\b/i },
  { id: 'allied-health', re: /\b(physical therapist|occupational therapist|speech[- ]language pathologist|respiratory therapist|radiologic technologist|radiology technician|sonographer|ultrasound technologist|physical therapy assistant|occupational therapy assistant|dental hygienist|paramedic|emt\b|phlebotomist)\b/i },
  { id: 'medical-lab', re: /\b(medical technologist|clinical laboratory|medical laboratory|lab(oratory)? technician|lab(oratory)? technologist|research coordinator|clinical trial (coordinator|assistant))\b/i },
  { id: 'healthcare-admin', re: /\b(healthcare|health care|medical office|medical billing|medical coder|clinical coder|patient access|practice manager|medical records|health information|revenue cycle|hospital administrator)\b/i },
  { id: 'education', re: /\b(teacher|educator|professor|faculty|lecturer|school counselor|school psychologist|instructional coach|curriculum (specialist|designer|developer)|education (specialist|coordinator|manager)|teaching assistant|early childhood educator)\b/i },
  { id: 'academic-support', re: /\b(academic advisor|academic counselor|student affairs|student success|admissions counselor|college recruiter|registrar|financial aid (counselor|advisor|officer))\b/i },
  { id: 'social-services', re: /\b(social worker|case manager|caseworker|family advocate|housing navigator|community outreach worker|community health worker|child welfare|human services specialist)\b/i },
  { id: 'legal', re: /\b(attorney|lawyer|paralegal|legal assistant|legal counsel|corporate counsel|legal analyst|law clerk|litigation (associate|attorney|paralegal)|legal secretary)\b/i },
  { id: 'public-policy', re: /\b(policy analyst|policy advisor|public policy|government affairs|government relations|legislative assistant|public affairs specialist|lobbyist)\b/i },
  { id: 'architecture', re: /\b(architect|architecture|urban planner|urban planning|landscape architect|architectural designer|bim (modeler|coordinator|specialist))\b/i },
  { id: 'design', re: /\b(ux designer|ui designer|product designer|graphic designer|visual designer|interaction designer|industrial designer|experience designer|web designer|design researcher)\b/i },
  { id: 'communications', re: /\b(technical writer|content writer|copywriter|journalist|communications (specialist|coordinator|manager|officer)|public relations|pr specialist|media relations|editor|grant writer)\b/i },
  { id: 'healthcare', re: /\b(medical assistant|patient care technician|patient care associate|patient services|care coordinator|caregiver|home health aide|physician assistant|physician|doctor|therapist|behavioral health|dental assistant|veterinary|vet tech)\b/i },
  { id: 'civil-engineering', re: /\b(civil|structural|geotechnical|transportation|water resources|traffic) (engineer|engineering|designer|technician)\b|\b(bridge|highway) engineer\b/i },
  { id: 'mechanical-engineering', re: /\b(mechanical|aerospace|aeronautical|automotive|thermal|hvac)\b[^,\n]{0,30}\b(engineer|engineering|designer|technician)\b/i },
  { id: 'electrical-engineering', re: /\b(electrical|power|controls|instrumentation|robotics)\b[^,\n]{0,30}\b(engineer|engineering|designer|technician)\b|\belectronics (engineer|engineering|designer)\b/i },
  { id: 'biomedical-engineering', re: /\b(biomedical|biomechanical|clinical|medical device) (engineer|engineering|designer|technician)\b/i },
  { id: 'manufacturing-engineering', re: /\b(manufacturing|industrial|process|materials|quality) (engineer|engineering|technician)\b|\b(quality engineer|manufacturing engineer)\b/i },
  { id: 'environmental-science', re: /\b(environmental|chemical|petroleum|mining|geological) (engineer|engineering|scientist|technician)\b/i },
  { id: 'research-assistant', re: /\b(research assistant|research associate|research aide|laboratory assistant|lab assistant)\b/i },
  { id: 'science', re: /\b(chemist|biologist|physicist|geologist|ecologist|microbiologist|research scientist|laboratory scientist|lab scientist)\b/i },
  { id: 'accounting', re: /\b(accountant|accounting|bookkeeper|bookkeeping|accounts payable|accounts receivable|staff accountant|accounting clerk)\b/i },
  { id: 'audit-tax', re: /\b(auditor|audit(ing)?|tax (accountant|analyst|preparer|associate)|taxation|internal audit)\b/i },
  { id: 'payroll', re: /\b(payroll (specialist|administrator|analyst|coordinator|clerk)|payroll)\b/i },
  { id: 'finance', re: /\b(financial analyst|finance (analyst|associate|manager|officer)|investment (analyst|banking|associate)|banker|treasury analyst|credit analyst|underwriter|financial planner|actuary)\b/i },
  { id: 'business', re: /\b(business analyst|business intelligence|business operations analyst|management analyst|strategy analyst)\b/i },
  { id: 'project-management', re: /\b(project (manager|coordinator|administrator|management)|program manager|program coordinator)\b/i },
  { id: 'human-resources', re: /\b(human resources|hr (generalist|specialist|coordinator|manager|assistant)|recruiter|recruiting coordinator|talent acquisition|people operations)\b/i },
  { id: 'sales', re: /\b(sales (representative|associate|manager|development|operations|engineer)|account executive|business development|salesperson)\b/i },
  { id: 'marketing', re: /\b(marketing|brand manager|content strategist|seo specialist)\b/i },
  { id: 'customer-service', re: /\b(customer service|customer success|client services|call center|contact center)\b/i },
  { id: 'operations', re: /\b(operations (analyst|associate|coordinator|manager|specialist)|supply chain|logistics coordinator|procurement (analyst|specialist|manager))\b/i },
];

// Who can apply: citizenship, security clearance, and visa sponsorship requirements.
const CITIZEN_RE = /\b(must be (a )?(u\.?s\.?|united states) citizen|(u\.?s\.?|united states) citizenship (is )?(required|mandatory)|requires? (u\.?s\.?|united states) citizenship|only (u\.?s\.?|united states) citizens|citizenship required|(u\.?s\.?|united states) citizens? only)/i;
const CLEARANCE_RE = /\b((active|current|existing|must (have|hold|possess|obtain|be able to obtain)|ability to obtain|eligib\w+ (for|to obtain)|requires?)[^.\n]{0,40}\b(secret|top secret|ts\/sci|ts-sci|dod|security) clearance|(secret|top secret|ts\/sci|ts-sci) clearance (is )?(required|needed))/i;
const NO_SPONSOR_RE = /\b((not|unable to|cannot|can ?not|won'?t|will not|does not|do not|are not able to) (currently )?(provide|offer|support|sponsor)[^.\n]{0,25}sponsor|no (visa |h-?1b )?sponsorship|without (the need for )?(current or future )?(visa )?sponsorship|sponsorship (is )?not (available|offered|provided))/i;

export function workAuth(text = '', sponsorshipField = '') {
  const t = String(text);
  const f = String(sponsorshipField || '');
  return {
    citizenOnly: CITIZEN_RE.test(t) || /citizenship is required/i.test(f),
    clearance: CLEARANCE_RE.test(t),
    noSponsorship: NO_SPONSOR_RE.test(t) || /does not offer sponsorship/i.test(f),
  };
}

// Trades and office roles whose titles borrow tech words ("Support Technician", "Systems", "Security").
const NOT_TECH = /\b(administrative|clerical|records|public works|civil|traffic|transportation|police|officer|lieutenant|sergeant|correctional|custodia\w*|maintenance|facilit\w*|building|hvac|electrician|electronics technician|plumb\w*|fire|nurs\w*|teacher|paraeducator|bus|food|cafeteria|recreation|engineering support|pharmacy|medical|dental|veterinar\w*|laborator\w*|lab technician|automotive|mechanic)\b/i;

export function categorize(title = '') {
  if (/\bengineer i,\s*ii\s*&\s*iii\b/i.test(title)) return null;
  if (/\belectronics technician\b/i.test(title) && /\b(building|security services|public works|transportation)\b/i.test(title)) return null;
  for (const c of CAREER_CATEGORIES) if (c.re.test(title)) return c.id;
  if (NOT_TECH.test(title) && !/\b(it|information technology|computer|network|help ?desk|service desk|software|cyber|data)\b/i.test(title.replace(new RegExp(NOT_TECH.source, 'gi'), ''))) return null;
  for (const c of CATEGORIES) if (c.re.test(title)) return c.id;
  if (/\b(engineer|engineering|engineering technician)\b/i.test(title)) return 'engineering';
  return null;
}

// Title decides first; otherwise the years of experience the posting asks for.
export function seniority(title = '', { years = null, entryHint = false } = {}) {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b|co-?op\b|apprentice|praktikum|werkstudent|working student/.test(t)) return 'intern';
  if (/\b(senior|sr\.?|lead|staff|principal|architect|manager|head of|director|tier ?(3|iii)\b|\biii\b)/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|entry|associate|graduate|new grad|tier ?(1|i)\b|level ?(1|i)\b|\bi\b$)/.test(t)) return 'entry';
  if (years != null) return years <= 2 ? 'entry' : years <= 4 ? 'mid' : 'senior';
  return entryHint ? 'entry' : 'mid';
}

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUM = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';
const YEARS_RE = new RegExp(`(?:minimum|at least|min\\.?)?\\s*(?:of\\s*)?${NUM}\\s*(?:\\+|plus)?\\s*(?:(?:-|–|to)\\s*${NUM}\\s*\\+?\\s*)?(?:\\(\\d+\\)\\s*)?years?`, 'gi');

// Smallest number of years the posting *requires* (ignores "preferred" lines), or null.
export function requiredYears(text = '') {
  const s = String(text).toLowerCase();
  const found = [];
  for (const m of s.matchAll(YEARS_RE)) {
    const n = WORD_NUM[m[1]] ?? Number(m[1]);
    if (!Number.isFinite(n) || n > 15) continue;
    // Only look within the same sentence/bullet.
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 90).split(/[.;\n]/)[0];
    const before = s.slice(Math.max(0, m.index - 60), m.index).split(/[.;\n]/).pop();
    if (!/experience|exp\b|working|in (it|a|an|the)\b|professional|hands-on|background/.test(after)) continue;
    if (/prefer|nice to have|bonus|plus\b|ideally/.test(after.slice(0, 60) + before.slice(-40))) continue;
    found.push(n);
  }
  // The strictest hard requirement is what screens you out.
  return found.length ? Math.max(...found) : null;
}

export function entryHint(text = '') {
  return /\b(no (prior )?experience (required|necessary|needed)|entry[- ]level|new grad(uate)?s?|recent (college )?graduates?|early[- ]career|0\s*-\s*[12] years|will train|training provided)\b/i.test(String(text));
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_SKIP = /(noreply|no-reply|donotreply|example\.|sentry|wixpress|privacy@|gdpr@|accommodation|accessibility|legal@|\.png|\.jpg|\.gif)/i;

export function extractEmails(text = '') {
  const found = new Set();
  for (const m of String(text).match(EMAIL_RE) || []) {
    const e = m.replace(/[.,;:]+$/, '').toLowerCase();
    if (!EMAIL_SKIP.test(e)) found.add(e);
  }
  return [...found].slice(0, 5);
}

export function toIso(value) {
  if (value == null || value === '') return null;
  let d;
  if (typeof value === 'number') d = new Date(value < 1e12 ? value * 1000 : value);
  else {
    const s = String(value);
    // Remotive omits the timezone; its timestamps are UTC.
    d = new Date(/T\d\d:\d\d(:\d\d)?$/.test(s) ? s + 'Z' : s);
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function ageDays(iso, now = Date.now()) {
  if (!iso) return Infinity;
  return (now - new Date(iso).getTime()) / 86400000;
}

export function looksRemote(...parts) {
  return parts.some((p) => /\bremote|anywhere|work from home|wfh\b|distributed|telecommut\w*|telework/i.test(String(p || '')));
}
