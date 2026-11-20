import { state, $, esc, store, download, toast, findJob, emit } from './core.js';

export const APPLICATION_STATUSES = [
  ['opened', 'Opened'],
  ['in_progress', 'In progress'],
  ['applied', 'Applied'],
  ['interview', 'Interview'],
  ['offer', 'Offer'],
  ['rejected', 'Not selected'],
  ['withdrawn', 'Withdrawn'],
];

const STATUS_NAMES = Object.fromEntries(APPLICATION_STATUSES);
const save = () => store.set('applications', state.applications);

export function trackApplicationOpen(job) {
  const now = new Date().toISOString();
  const record = state.applications.find((item) => item.id === job.id);
  if (record) {
    Object.assign(record, { lastOpenedAt: now, openCount: (record.openCount || 0) + 1 });
  } else {
    state.applications.unshift({
      id: job.id, title: job.title, company: job.company || '', location: job.location || '',
      category: job.category || '', applyUrl: job.applyUrl || '', url: job.url || '',
      sourceName: job.sourceName || '', status: 'opened', firstOpenedAt: now,
      lastOpenedAt: now, appliedAt: '', openCount: 1, notes: '',
    });
    state.applications = state.applications.slice(0, 1000);
  }
  save();
  return record || state.applications[0];
}

export function updateApplication(id, changes) {
  const record = state.applications.find((item) => item.id === id);
  if (!record) return;
  if (changes.status && !STATUS_NAMES[changes.status]) throw new Error('Choose a valid application status.');
  if (changes.status) {
    record.status = changes.status;
    if (changes.status === 'applied' && !record.appliedAt) record.appliedAt = new Date().toISOString();
  }
  if (changes.notes != null) record.notes = String(changes.notes).slice(0, 2000);
  save();
  if (changes.status) emit('applications', record);
}

export function promptApplicationCompletion(jobId) {
  const job = findJob(jobId) || state.applications.find((item) => item.id === jobId);
  if (!job) {
    toast('Could not find this posting to add it to your tracker.');
    return;
  }
  trackApplicationOpen(job);
  const dialog = $('#applicationPrompt');
  if (!dialog?.showModal) {
    toast('The job was saved to your tracker. This browser cannot show the completion prompt.');
    return;
  }
  $('[data-prompt-job]', dialog).textContent = `${job.title} · ${job.company || 'Employer'}`;
  $('form', dialog).addEventListener('submit', (event) => {
    const response = event.submitter?.value;
    if (response === 'applied') {
      updateApplication(jobId, { status: 'applied' });
      toast('Marked as applied. You can update its status in Applications.');
    } else if (response === 'in_progress') {
      updateApplication(jobId, { status: 'in_progress' });
      toast('Saved as in progress in Applications.');
    }
  }, { once: true });
  dialog.showModal();
}

function spreadsheetCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function trackerExport(format = 'csv', records = state.applications) {
  const separator = format === 'tsv' ? '\t' : ',';
  const rows = [
    ['Company', 'Job title', 'Location', 'Status', 'First opened', 'Last opened', 'Applied on', 'Application link', 'Job posting link', 'Source', 'Notes'],
    ...records.map((item) => [
      item.company, item.title, item.location, STATUS_NAMES[item.status] || item.status,
      item.firstOpenedAt, item.lastOpenedAt, item.appliedAt, item.applyUrl, item.url, item.sourceName, item.notes,
    ]),
  ];
  return rows.map((row) => row.map(spreadsheetCell).join(separator)).join('\r\n');
}

export function downloadTracker(format = 'csv') {
  if (!['csv', 'tsv'].includes(format)) throw new Error('Choose CSV or TSV for export.');
  const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8';
  download(`job-applications.${format}`, `\uFEFF${trackerExport(format)}`, mime);
  toast(`Downloaded ${format.toUpperCase()} tracker.`);
}
