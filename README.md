# Job Matcher

A local web app that pulls tech job postings from the last 24 hours to 7 days (helpdesk, IT, software, DevOps, security, data, QA), and uses Gemini to build a tailored apply kit for each one.

## Run it

```bash
npm install
npm start
```

Open http://localhost:4317. The server only listens on 127.0.0.1.

The first visit walks you through five questions: your resume (PDF, Word or text, read in the browser), the kinds of roles you want, your experience level, remote or near a city, and an optional Gemini key (free at aistudio.google.com/apikey). You can redo them from Settings.

## Pages

| Page | URL | What it's for |
|---|---|---|
| Jobs | `/`, `/jobs/:id` | Filtered feed with the posting on the right. Each posting has its own link. |
| Map | `/map` | The same results on a US map. Click a city dot or state to list its jobs. |
| Apply | `/apply/:id` | Tailor with Gemini, edit the six documents, then send. |
| Applications | `/applications` | Every apply kit you've made. |
| Resume | `/resume` | Upload, edit and switch between resumes. |
| Settings | `/settings` | Gemini, your details, location and Adzuna, job sources, your data. |

## Where jobs come from

| Source | Covers | Setup |
|---|---|---|
| Remotive, Remote OK, Jobicy, Himalayas, We Work Remotely | Remote roles | none |
| Arbeitnow | Remote + Europe | none |
| SimplifyJobs new-grad and internship lists | Entry-level and intern roles at hundreds of companies | none |
| Adzuna | On-site jobs near your city, plus an entry-level search pass | free key |
| Greenhouse / Lever / Ashby company boards | Direct from employers' own hiring pages | add company slugs in Settings |

LinkedIn and Indeed are not scraped: both forbid it in their terms and block bots. Instead, each apply kit links to a LinkedIn recruiter search and a LinkedIn job search for that role.

### Entry-level focus

**Level** filters by internship, entry, mid and senior. The levels you pick also cap the experience a posting may ask for: entry hides postings that need 3+ years, mid hides 5+. Each posting shows the years it asks for ("needs 2+ yrs"); requirements marked "preferred" are ignored. List sources that only carry a title (Simplify) get their full posting text fetched from the company's job page when you open them or press Tailor (Greenhouse, Lever, Ashby, Workday, SmartRecruiters and Workable through their public APIs, other sites through their structured job data).

While the tab is open it checks for new postings every 20 minutes (and right away when you come back to the tab), tags them **new**, and shows the count in the tab title.

### Location search and map

Type a city, state or ZIP under **Where** and pick a distance (10 to 100 miles, or the whole state). Postings are matched by distance using the bundled `zipcodes` dataset; sort by **Closest** to see the nearest first. With an Adzuna key, the local on-site search also moves to that place.

**Map** (`/map`) shows the current results on a US map: states shaded by posting count, a dot per city sized by postings. Click a dot or state to list its jobs. The map is drawn from bundled `us-atlas` shapes with `d3-geo`, so it loads no map tiles and contacts no map service. Remote postings and ones without a US city aren't plotted; the note under the map says how many.

Feeds are cached in `.cache/` (Remotive for 6 hours, as it asks; others for 1 hour). The refresh button forces a new fetch.

## The apply kit

Gemini gets the posting and your resume and returns: a match score with strengths and honest gaps, a tailored resume, a cover letter, a recruiter email, a LinkedIn connection note and message, and likely screening answers. It is told never to invent experience, and the server double-checks two things itself: screening answers about work authorization, visas, clearance, relocation, start date or salary are replaced with "answer this yourself" unless your resume or notes say it, and any sign-off Gemini adds to the email is removed so your signature isn't doubled. If the newest Gemini models are busy, it tries two models at a time and works down the list.

"Send it" then:
- **Apply**: save the tailored resume as PDF, open the real application form, and copy the cover letter to paste in.
- **Email recruiter**: opens your mail app (or Gmail) with the email filled in. Recruiter addresses found in the posting are pre-filled. You attach the PDF and press send yourself.
- **LinkedIn**: copies your note and opens a recruiter search at that company.

Nothing is submitted automatically. Employer forms (Workday, Greenhouse, Lever) need logins, CAPTCHAs or per-employer keys, and a human should read every application before it goes out.

## Privacy

- No accounts, analytics, cookies, CDNs or remote images. Fonts and the PDF/DOCX readers are served from `node_modules`.
- Resume files are parsed in the browser; only the extracted text is kept, in that browser's localStorage. Keys, settings and generated kits live there too. **Settings > Erase everything** clears it.
- Network traffic: requests to the job sources above, and to Google's Gemini API when you press Tailor. By default your email, phone and LinkedIn/GitHub links are swapped for placeholders before the resume is sent, and restored locally afterwards.
- You can put `GEMINI_API_KEY` (and `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`) in the environment instead of the browser.

## Hosting on Vercel

The repo deploys to Vercel as-is (`vercel.json` routes everything through `api/index.js`, the same Express app). Differences from running locally:

- Each visitor enters their own Gemini key (and optional Adzuna key) in Settings; it stays in their browser. Server-side `GEMINI_API_KEY`/`ADZUNA_*` env vars are **ignored** on Vercel so a public URL can't spend your quota. Set `ALLOW_SERVER_KEYS=1` only if the deployment is private (for example behind Vercel password protection).
- Resume text passes through the Vercel function on its way to Gemini. It is not stored or logged.
- The job cache lives in `/tmp` per function instance, and the refresh button can't force-bypass it.

## Development

```bash
npm test
```

`server/` holds the Express server, source adapters (`sources.js`), aggregation and role classification (`jobs.js`, `text.js`), and the Gemini client (`gemini.js`). `public/` is the no-build front end.
