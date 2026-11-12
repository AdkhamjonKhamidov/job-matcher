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
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

// Order matters: first match wins, so specific roles come before broad ones.
export const CATEGORIES = [
  { id: 'helpdesk', label: 'Helpdesk & Support', re: /\b(help ?desk|service ?desk|desktop support|tech(nical)? support|it support|support (technician|engineer)|(it|technical|desktop|application|systems?|computer) support (specialist|analyst)|end[- ]user support|field (service )?tech(nician)?|tier ?(1|2|i|ii)\b|deskside|it technician|computer technician)/i },
  { id: 'security', label: 'Security', re: /\b(security|cyber|soc analyst|penetration|pentest|infosec|grc analyst|iam engineer)/i },
  { id: 'devops', label: 'DevOps & Cloud', re: /\b(devops|dev ops|sre\b|site reliability|cloud (engineer|architect|ops)|platform engineer|infrastructure engineer|kubernetes|devsecops)/i },
  { id: 'it', label: 'IT & Sysadmin', re: /\b(sys(tems)? ?admin|system administrator|systems engineer|network (engineer|administrator|technician|analyst)|it (specialist|administrator|analyst|manager|engineer|coordinator|operations)|m365|microsoft 365|intune|active directory|noc (engineer|technician|analyst)|information technology)/i },
  { id: 'data', label: 'Data & ML', re: /\b(data (engineer|analyst|scientist)|machine learning|ml engineer|ai engineer|analytics engineer|bi (developer|analyst)|mlops|database administrator|\bdba\b)/i },
  { id: 'qa', label: 'QA & Test', re: /\b(qa\b|quality assurance|test (engineer|automation|analyst)|engineer in test|sdet|automation tester|software tester)/i },
  { id: 'swe', label: 'Software Engineering', re: /\b(software|developer|programmer|engineer(ing)? (i|ii|iii)\b|front[- ]?end|back[- ]?end|full[- ]?stack|web dev|ios|android|mobile (engineer|developer)|swe\b|sde\b|golang|python engineer|java engineer|\.net|react|node(\.js)? engineer|firmware|embedded)/i },
];

export function categorize(title = '') {
  for (const c of CATEGORIES) if (c.re.test(title)) return c.id;
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
  return parts.some((p) => /\bremote|anywhere|work from home|wfh\b|distributed/i.test(String(p || '')));
}
