// Resume reading (in the browser only), contact masking, and print-to-PDF.
import { esc } from './core.js';

let pdfjs;
export async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    pdfjs ??= await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      // Rebuild lines from y positions so bullets and sections survive.
      let lastY = null, line = '';
      const lines = [];
      for (const item of content.items) {
        const y = Math.round(item.transform?.[5] ?? 0);
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
        line += item.str;
        lastY = y;
      }
      lines.push(line);
      pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
    }
    return pages.join('\n\n');
  }
  if (name.endsWith('.docx')) {
    if (!window.mammoth) await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/mammoth/mammoth.browser.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('Word reader did not load.'));
      document.head.appendChild(s);
    });
    const { value } = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value.replace(/\n{3,}/g, '\n\n').trim();
  }
  if (/\.(txt|md)$/.test(name)) return (await file.text()).trim();
  throw new Error('Use a PDF, Word (.docx) or text file.');
}

// Swap contact details for placeholders before text goes to Gemini; restore them afterwards.
export function maskText(text) {
  const map = {};
  let n = 0;
  const swap = (re, label) => {
    text = text.replace(re, (m) => {
      const existing = Object.keys(map).find((k) => map[k] === m);
      if (existing) return existing;
      n++;
      const key = `[${label}${n > 1 ? n : ''}]`;
      map[key] = m;
      return key;
    });
  };
  swap(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, 'EMAIL');
  swap(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com)\/[^\s)]+/gi, 'LINK');
  swap(/(?<![\w])(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w])/g, 'PHONE');
  return { text, map };
}

export function unmask(value, map) {
  if (typeof value === 'string') return Object.entries(map).reduce((s, [k, v]) => s.split(k).join(v), value);
  if (Array.isArray(value)) return value.map((v) => unmask(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmask(v, map)]));
  return value;
}

// Render light markdown into a print-only node and open the print dialog (Save as PDF).
export function printDoc(text, title) {
  const html = esc(text).split('\n').map((line) => {
    if (/^# /.test(line)) return `<h1>${line.slice(2)}</h1>`;
    if (/^## /.test(line)) return `<h2>${line.slice(3)}</h2>`;
    if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`;
    if (/^\s*[-*] /.test(line)) return `<li>${line.replace(/^\s*[-*] /, '')}</li>`;
    if (!line.trim()) return '<br>';
    return `<p>${line}</p>`;
  }).join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  const node = document.createElement('div');
  node.className = 'print-doc';
  node.innerHTML = html;
  document.body.appendChild(node);
  const prevTitle = document.title;
  document.title = title;
  window.print();
  document.title = prevTitle;
  node.remove();
}
