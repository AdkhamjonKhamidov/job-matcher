# Job Matcher

A local web app that finds recent jobs across technology, healthcare, education, legal, design, engineering and science, accounting and finance, and business. Gemini, OpenAI GPT, or Anthropic Claude can optionally build a tailored apply kit.

## Run it

```bash
npm install
npm start
```

Open http://localhost:4317. The server only listens on 127.0.0.1.

The first visit takes four short steps: optionally add a resume (PDF, Word or text, read in the browser), pick career areas and roles, choose your experience level, and choose where you want to work. No account or API key is needed to search. You can redo these choices from Settings. AI-written documents and growth plans are optional and can be set up later; on-site job search can be expanded with an optional free Adzuna account.

## Pages

| Page | URL | What it's for |
|---|---|---|
| Jobs | `/`, `/jobs/:id` | Filtered feed with the posting on the right. Each posting has its own link. |
| Map | `/map` | US job results on a world map. Click a city dot or state to list its jobs. |
| Apply | `/apply/:id` | Tailor with your selected AI provider, edit the six documents, then send. |
| Applications | `/applications` | Track applications locally, update statuses, download CSV/TSV, and revisit apply kits. |
| Grow | `/grow` | Projects to build and certifications to get for your target roles, with a tracker. |
| Career sources | `/sources` | Direct employer and specialist boards by field; import a public posting link or paste its details. |
| Resume | `/resume` | Upload, edit and switch between resumes. |
| Settings | `/settings` | AI provider and keys, your details, location and Adzuna, job sources, your data. |

## Where jobs come from

| Source | Covers | Setup |
|---|---|---|
| Remotive, Remote OK, Jobicy, Himalayas, We Work Remotely | Remote roles | none |
| Arbeitnow | Remote + Europe | none |
| SimplifyJobs new-grad and internship lists | Entry-level and intern roles at hundreds of companies | none |
| Adzuna | On-site jobs across supported career fields near your city, plus an entry-level search pass | optional free account and keys |
| Maryland schools and colleges: Baltimore County and Harford (Oracle), Howard County and UMD (Workday), Prince George's, Frederick, Carroll, Washington, St. Mary's, Cecil and Talbot (AppliTrack) | School-system and campus IT technician / helpdesk roles | none |
| Maryland governments: Baltimore, Prince George's, Montgomery, Howard, Anne Arundel and Charles counties (NEOGOV), State of Maryland (JobAps) | Public-sector IT roles | none |
| Greenhouse / Lever / Ashby company boards | Direct from employers' own hiring pages; includes verified healthcare and finance/business boards | configure company slugs in Settings |

LinkedIn and Indeed are not scraped: both forbid it in their terms and block bots. Instead, each apply kit links to a LinkedIn recruiter search and a LinkedIn job search for that role.

The Career sources page links to direct hospital and employer career sites, allied-health and engineering association boards, Handshake, and operations/supply-chain sources. It also explains which sources are direct boards versus curated or federal listings. USAJOBS is a link-out only: its structured API requires a separately requested key. SmartRecruiters is not used as a general feed because its API requires authorized credentials. Workday and other sites without a documented public feed remain link-first.

The directory also covers education and social work (SchoolSpring, HigherEdJobs, NIH, NASW), legal and public-interest work (ABA, ACLU, USAJOBS), and architecture/design (AIA). These are direct destinations, not scraped feeds; some professional-board features may require membership or a user account.

### Import a posting

On `/sources`, paste an HTTPS link to one public job posting. The importer supports Schema.org `JobPosting` data and the documented public Greenhouse, Lever, and Ashby posting endpoints; it does not sign in or scrape restricted pages. If a site does not expose readable job details, copy the posting text into the fallback form. The imported item is saved in this browser and links to the original application page when provided. URLs are checked against private-network targets and are not fetched from the browser.

Public ATS feeds are employer-specific rather than universal searches. The [Greenhouse job-board API](https://docs.greenhouse.io/job-board.html) can provide `first_published`/`updated_at`, the [Ashby public API](https://developers.ashbyhq.com/docs/public-job-posting-api) provides `publishedAt`, and [Lever's postings API](https://github.com/lever/postings-api) does not provide a dependable posting timestamp in its documented listing schema; the app therefore should not treat Lever freshness as an exact post date. A direct employer page remains the source of truth for whether a job is still open.

### Career fields and experience levels

Role matching covers technology, healthcare, education and social services, legal and public policy, architecture and design, engineering and science, accounting and finance, and business and operations. Roles are grouped into collapsible fields in onboarding and filters; onboarding also lets people search for a role or specialty. Healthcare choices include pharmacy technicians, hospital data entry and records, residency, and clinical research. It classifies job titles from the available feeds; each source has its own coverage, so remote feeds may not publish every profession. Adzuna searches all job categories when configured.

**Level** filters by internship, entry, mid and senior. The levels you pick also cap the experience a posting may ask for: entry hides postings that need 3+ years, mid hides 5+. Each posting shows the years it asks for ("needs 2+ yrs"); requirements marked "preferred" are ignored. List sources that only carry a title (Simplify) get their full posting text fetched from the company's job page when you open them or press Tailor (Greenhouse, Lever, Ashby, Workday, SmartRecruiters and Workable through their public APIs, other sites through their structured job data).

While the tab is open it checks for new postings every 20 minutes (and right away when you come back to the tab), tags them **new**, and shows the count in the tab title.

### Schools and government

Public employers post on their own hiring systems rather than job boards, so the app reads those systems directly (the list is in `server/public-sector.js`; adding another Oracle, Workday, AppliTrack, NEOGOV or JobAps employer is one line). Their openings stay up for weeks, so by default they're shown for up to 30 days even when the date filter is shorter (More filters turns this off). Montgomery County Public Schools (Taleo), Anne Arundel and Baltimore City schools don't publish a readable feed, so they aren't included.

### Work authorization

Work authorization is optional in Settings. Postings are checked for "must be a US citizen", security clearance and "no sponsorship" wording (and Simplify's own citizenship field). Green card holders don't see citizenship-only or clearance jobs; people who need sponsorship also don't see no-sponsorship jobs. The top results are read in the background so this works before you open them. Gemini is told your status, so it can answer authorization questions honestly and never claims citizenship.

### Location search and map

Type a city, state or ZIP under **Where** and pick a distance (10 to 100 miles, or the whole state). Postings are matched by distance using the bundled `zipcodes` dataset; sort by **Closest** to see the nearest first. With an Adzuna account connected in Settings, the local on-site search also moves to that place.

**Map** (`/map`) shows US job results on a flat, equirectangular world map, with US states shaded by posting count and a dot per city sized by postings. It opens focused on the continental US with nearby countries muted for geographic context; use **US** to return to that view or **World** to see the full map, including Alaska and Hawaii. Drag or scroll horizontally to wrap around the world. Click a dot or state to list its jobs. Geography is bundled locally from `us-atlas` and `world-atlas` with `d3-geo`, so it loads no map tiles and contacts no map service. Remote postings and ones without a US city aren't plotted; the note under the map says how many.

Feeds are cached in `.cache/` (Remotive for 6 hours, as it asks; others for 1 hour). The refresh button forces a new fetch.

## The apply kit

The selected Gemini, OpenAI GPT, or Anthropic Claude model gets the posting and your resume and returns: a match score with strengths and honest gaps, a tailored resume, a cover letter, a recruiter email, a LinkedIn connection note and message, and likely screening answers. It is told never to invent experience, and the server double-checks work authorization, visa, clearance, relocation, start-date and salary answers against the resume and notes. Any model sign-off is removed so your signature isn't doubled. Gemini can fall back across models when busy; OpenAI and Anthropic retry other available models on transient failures.

"Send it" then:
- **Apply**: save the tailored resume as PDF, open the real application form, and copy the cover letter to paste in.
- **Email recruiter**: opens your mail app (or Gmail) with the email filled in. Recruiter addresses found in the posting are pre-filled. You attach the PDF and press send yourself.
- **LinkedIn**: copies your note and opens a recruiter search at that company.

Nothing is submitted automatically. Employer forms (Workday, Greenhouse, Lever) need logins, CAPTCHAs or per-employer keys, and a human should read every application before it goes out.

## The application tracker

Opening an application's direct employer link adds the job to the tracker and asks whether the application is complete. Users can mark it applied, in progress, or defer the choice, then update statuses and private notes in **Applications**. Tracker data is stored only in this browser and exports to spreadsheet-friendly CSV and TSV.

## Grow

`/grow` counts which skills and certifications postings for your target roles and level ask for (across the US, last 7 days), marks what your resume already shows, and asks the selected AI provider for a plan specific to those roles: 3 to 5 projects that prove missing skills (with steps, what to show employers and an honest resume line to add once done), 2 to 4 certifications in priority order with what each qualifies you for, cost, study time and a study plan, plus quick resume fixes and what to skip for now. Each item has a status and checkable steps, saved in your browser; making a new plan keeps your progress on items with the same name.

## Privacy

- No accounts, analytics, cookies, CDNs or remote images. Fonts and the PDF/DOCX readers are served from `node_modules`.
- Resume files are parsed in the browser; only the extracted text is kept, in that browser's localStorage. Keys, settings and generated kits live there too. **Settings > Erase everything** clears it.
- Gemini, OpenAI, Anthropic, and Adzuna credentials are stored in browser localStorage, not encrypted at rest. Hosted requests use HTTPS; the local server binds only to `127.0.0.1`. Avoid saving keys on shared devices. Encryption in the browser would not prevent an active page, malicious extension or script injection from using a key.
- Network traffic: requests to the job sources above and to the selected AI provider only when you request AI writing. By default your email, phone and links are swapped for placeholders before the resume is sent, and restored locally afterwards.
- You can put `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` (and `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`) in the environment instead of the browser.

## Hosting on Vercel

The repo deploys to Vercel as-is (`vercel.json` routes everything through `api/index.js`, the same Express app). Differences from running locally:

- Each visitor can set up AI writing in Settings with their own Gemini, OpenAI, or Anthropic key; optional Adzuna credentials also stay in their browser. Server-side provider/Adzuna keys are **ignored** on Vercel so a public URL can't spend your quota. Set `ALLOW_SERVER_KEYS=1` only if the deployment is private (for example behind Vercel password protection).
- Vercel responses include HTTP Strict Transport Security (HSTS), which tells browsers to keep using HTTPS for the site.
- Resume text passes through the Vercel function on its way to the selected AI provider. It is not stored or logged.
- The job cache lives in `/tmp` per function instance, and the refresh button can't force-bypass it.

## Development

```bash
npm test
```

`server/` holds the Express server, source adapters (`sources.js`), aggregation and role classification (`jobs.js`, `text.js`), and provider adapters (`ai.js`, `gemini.js`). `public/` is the no-build front end.
