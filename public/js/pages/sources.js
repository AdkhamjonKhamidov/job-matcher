// /sources - vetted employer and specialist job boards with an optional posting importer.
import { state, $, $$, esc, api, toast, CAREER_FIELDS, saveFilters } from '../core.js';
import { addImportedJob } from '../data.js';
import { navigate } from '../router.js';

const LINKS = {
  healthcare: [
    { name: 'Mayo Clinic Careers', url: 'https://jobs.mayoclinic.org/', note: 'Hospital, nursing, allied health, science, and new-graduate roles.' },
    { name: 'Cleveland Clinic Careers', url: 'https://jobs.clevelandclinic.org/', note: 'Nursing, allied health, facilities, finance, and supply chain.' },
    { name: 'Johns Hopkins Medicine Careers', url: 'https://jobs.jh.edu/', note: 'Hospital and university openings, including clinical, research, and early-career roles.' },
    { name: 'HCA Healthcare Careers', url: 'https://careers.hcahealthcare.com/', note: 'Hospital jobs, graduate nursing programs, and clinical support roles.' },
    { name: 'Kaiser Permanente Careers', url: 'https://www.kaiserpermanentejobs.org/', note: 'Healthcare, pharmacy, research, and administrative roles.' },
    { name: 'ASHP CareerPharm', url: 'https://careers.ashp.org/', note: 'Pharmacist, pharmacy technician, residency, and clinical pharmacy listings.' },
    { name: 'ACRP Career Center', url: 'https://careers.acrpnet.org/', note: 'Clinical research coordinator, associate, and research operations jobs.' },
    { name: 'AAMC ERAS Residency Applications', url: 'https://students-residents.aamc.org/applying-residencies-eras/', note: 'Official residency application guidance and timelines; this is a training-program application service, not a general job board.' },
    { name: 'Maven Clinic Careers', url: 'https://www.mavenclinic.com/careers', note: 'Healthcare technology and provider opportunities; public Greenhouse listings are available.', feed: ['greenhouse', 'mavenclinic'] },
    { name: 'Lyra Health Careers', url: 'https://careers.lyrahealth.com/all-lyra-health-jobs', note: 'Behavioral healthcare and provider opportunities; public Lever listings are available.', feed: ['lever', 'lyrahealth'] },
    { name: 'APTA Career Center', url: 'https://www.apta.org/your-career', note: 'Physical therapy career center for students through experienced clinicians.' },
    { name: 'ASHA Career Portal', url: 'https://careers2.asha.org/jobs', note: 'Speech-language pathology and audiology jobs, fellowships, and internships.' },
  ],
  education: [
    { name: 'SchoolSpring', url: 'https://www.schoolspring.com/', note: 'Teaching and other school jobs with employer postings and job alerts.' },
    { name: 'HigherEdJobs', url: 'https://www.higheredjobs.com/', note: 'Faculty, staff, and administrative openings at colleges and universities.' },
    { name: 'NIH Careers', url: 'https://hr.nih.gov/careers', note: 'Federal science, research, and student hiring paths.' },
    { name: 'NASW Social Work Career Center', url: 'https://careers.socialworkers.org/', note: 'Social work listings and professional resources; some resources may require NASW membership.' },
  ],
  legal: [
    { name: 'ABA Career Center', url: 'https://jobs.americanbar.org/', note: 'Legal listings including attorney, paralegal, and law-faculty roles.' },
    { name: 'ACLU Careers', url: 'https://www.aclu.org/careers', note: 'Public-interest legal, policy, advocacy, and operations roles.' },
    { name: 'USAJOBS', url: 'https://www.usajobs.gov/', note: 'Federal attorney, policy, and public-service openings.' },
  ],
  design: [
    { name: 'AIA Career Center', url: 'https://careercenter.aia.org/', note: 'Architecture and design jobs with search, alerts, and employer applications.' },
    { name: 'Siemens Careers', url: 'https://jobs.siemens.com/en_US/externaljobs', note: 'Industrial design, engineering, and built-environment technology roles.' },
  ],
  engineering: [
    { name: 'NASA Careers', url: 'https://www.nasa.gov/careers/', note: 'Engineering, science, research, internships, and federal early-career roles.' },
    { name: 'Siemens Careers', url: 'https://jobs.siemens.com/en_US/externaljobs', note: 'Engineering, manufacturing, automation, and industrial technology.' },
    { name: 'IEEE Job Site', url: 'https://jobs.ieee.org/', note: 'Electrical, electronics, computing, and technology roles.' },
    { name: 'ASME Career Center', url: 'https://careercenter.asme.org/', note: 'Mechanical engineering and related disciplines.' },
    { name: 'NSPE Career Center', url: 'https://www.nspe.org/career-growth/career-center', note: 'Recent civil, electrical, mechanical, and project engineering postings.' },
    { name: 'SWE Career Center', url: 'https://careers.swe.org/', note: 'Engineering roles and career resources for women in engineering.' },
    { name: 'AIAA Career Center', url: 'https://careercenter.aiaa.org/', note: 'Aerospace and aviation engineering roles.' },
  ],
  finance: [
    { name: 'EY Careers', url: 'https://www.ey.com/en_us/careers', note: 'Assurance, tax, student and entry-level, and experienced roles.' },
    { name: 'JPMorganChase Students & Graduates', url: 'https://www.jpmorganchase.com/careers/explore-opportunities/students-and-graduates', note: 'Internships, pre-internship programs, and graduate roles.' },
    { name: 'Deloitte Careers', url: 'https://www.deloitte.com/us/en/careers/careers.html', note: 'Audit, tax, consulting, early-career, and experienced paths.' },
    { name: 'KPMG Careers', url: 'https://www.kpmguscareers.com/', note: 'Audit, tax, advisory, and campus opportunities.' },
    { name: 'PwC Careers', url: 'https://www.pwc.com/us/en/careers.html', note: 'Accounting, tax, advisory, internships, and entry-level roles.' },
    { name: 'Stripe Careers', url: 'https://stripe.com/careers/search', note: 'Fintech, finance, and business technology; public Greenhouse listings are available.', feed: ['greenhouse', 'stripe'] },
    { name: 'Wealthfront Careers', url: 'https://www.wealthfront.com/careers', note: 'Financial services, brokerage operations, and compliance; public Lever listings are available.', feed: ['lever', 'wealthfront'] },
  ],
  business: [
    { name: 'Target Careers', url: 'https://corporate.target.com/careers', note: 'Corporate, stores, supply chain, operations, and internships.' },
    { name: 'Handshake Find Jobs', url: 'https://joinhandshake.com/find-jobs/', note: 'Student and new-graduate listings; access may require a school account.' },
    { name: 'USAJOBS', url: 'https://www.usajobs.gov/', note: 'Federal business, finance, HR, operations, and recent-graduate roles.' },
    { name: 'CSCMP Career Center', url: 'https://careers.cscmp.org/', note: 'Supply chain, logistics, and operations roles.' },
    { name: 'Walmart Careers', url: 'https://careers.walmart.com/us/en/home', note: 'Retail, supply chain, healthcare, corporate, and operations roles.' },
    { name: 'Airbnb Careers', url: 'https://careers.airbnb.com/', note: 'Business and operations roles; public Greenhouse listings are available.', feed: ['greenhouse', 'airbnb'] },
    { name: 'NACE', url: 'https://www.naceweb.org/', note: 'College recruiting and early-career hiring resources; not a job board.' },
  ],
  technology: [
    { name: 'Ramp Careers', url: 'https://ramp.com/careers', note: 'Fintech, engineering, and business operations; public Ashby listings are available.', feed: ['ashby', 'ramp'] },
    { name: 'Simplify new-grad & internship lists', url: 'https://github.com/SimplifyJobs/', note: 'Curated entry-level and internship links, refreshed by the community.' },
  ],
};

export function render(el) {
  let urlValue = '', paste = { title: '', company: '', location: '', applyUrl: '', description: '' };
  let busy = false, status = '', error = false;
  const activeBoards = state.settings.boards || state.config?.defaultBoards || {};

  const draw = () => {
    el.innerHTML = `
      <div class="page page-narrow page-sources">
        <header class="page-head">
          <h1>Career sources</h1>
          <p class="muted">Go straight to employers and specialist boards for fresh openings. Each link opens the original source; availability varies by employer and field.</p>
        </header>

        <section class="card source-import">
          <h2>Bring a posting into your feed</h2>
          <p class="muted">Paste a public, individual job link. We can read structured job details and public Greenhouse, Lever, or Ashby postings. No account login is needed.</p>
          <form data-import-url>
            <label class="field"><span>Job posting link</span><input data-url type="url" required maxlength="2000" value="${esc(urlValue)}" placeholder="https://company.com/careers/jobs/123"></label>
            <button type="submit" class="btn accent" ${busy ? 'disabled' : ''}>${busy ? 'Reading posting…' : 'Import job link'}</button>
          </form>
          <details>
            <summary>Paste details from another job site</summary>
            <p class="muted small">Use this for sites that require a sign-in or do not publish readable job details. Copy the public posting text yourself.</p>
            <form data-import-text>
              <div class="row">
                <label class="field grow"><span>Job title</span><input data-paste="title" required maxlength="180" value="${esc(paste.title)}"></label>
                <label class="field grow"><span>Employer</span><input data-paste="company" required maxlength="120" value="${esc(paste.company)}"></label>
              </div>
              <label class="field"><span>Location (optional)</span><input data-paste="location" maxlength="160" value="${esc(paste.location)}"></label>
              <label class="field"><span>Original application link (optional)</span><input data-paste="applyUrl" type="url" maxlength="2000" value="${esc(paste.applyUrl)}" placeholder="https://employer.com/job/123"></label>
              <label class="field"><span>Job description</span><textarea data-paste="description" rows="7" required maxlength="20000">${esc(paste.description)}</textarea></label>
              <button type="submit" class="btn" ${busy ? 'disabled' : ''}>Parse and add job</button>
            </form>
          </details>
          <p class="status${error ? ' err' : ''}" data-import-status role="status">${esc(status)}</p>
        </section>

        <div class="career-source-groups">
          ${CAREER_FIELDS.map((field) => `
            <section class="card career-source-group">
              <header>
                <div><h2>${esc(field.label)}</h2><p class="muted small">Employer career pages and field-specific boards.</p></div>
                <button type="button" class="btn ghost small" data-field="${esc(field.id)}">Search ${esc(field.label)} jobs</button>
              </header>
              <ul>${(LINKS[field.id] || []).map((link) => `
                <li><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.name)}</a><span>${esc(link.note)}</span>${link.feed ? `<span class="source-feed">${activeBoards[link.feed[0]]?.includes(link.feed[1]) && !state.settings.disabledSources.includes(link.feed[0]) ? 'Also in your feed' : 'Not currently in your feed'}</span>` : ''}</li>
              `).join('')}</ul>
            </section>
          `).join('')}
        </div>
        <p class="muted small source-limit">A direct employer board is usually the freshest source. This app does not scrape sign-in-only sites or restricted job boards. Its built-in feeds are refreshed independently and may not cover every employer.</p>
      </div>`;
  };

  const importJob = async (body) => {
    busy = true; status = 'Reading the posting…'; error = false; draw();
    try {
      const { job } = await api('/api/import', body);
      const added = addImportedJob(job);
      toast(`Added ${added.title} to your feed.`);
      navigate(`/jobs/${encodeURIComponent(added.id)}`);
    } catch (err) {
      status = err.message;
      error = true;
      busy = false;
      draw();
    }
  };

  el.addEventListener('submit', (e) => {
    if (e.target.matches('[data-import-url]')) {
      e.preventDefault();
      urlValue = $('[data-url]', el).value.trim();
      importJob({ url: urlValue });
    } else if (e.target.matches('[data-import-text]')) {
      e.preventDefault();
      paste = Object.fromEntries($$('[data-paste]', el).map((input) => [input.dataset.paste, input.value.trim()]));
      importJob(paste);
    }
  });

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-field]');
    if (!b) return;
    const field = CAREER_FIELDS.find((item) => item.id === b.dataset.field);
    if (!field) return;
    state.filters.roles = [...field.roles];
    saveFilters();
    navigate('/');
  });

  draw();
}
