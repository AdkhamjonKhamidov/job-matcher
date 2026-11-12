// Disk cache for public job feeds so restarts don't re-hit rate-limited APIs.
// Only public job listings are cached here; never resumes, keys or generated text.

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Vercel's filesystem is read-only except /tmp.
const DIR = process.env.VERCEL ? '/tmp/job-matcher-cache' : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache');
const memory = new Map();
const inflight = new Map();

const fileFor = (key) => path.join(DIR, createHash('sha256').update(key).digest('hex').slice(0, 24) + '.json');

export async function cached(key, ttlMs, producer, { force = false } = {}) {
  const now = Date.now();
  if (!force) {
    let hit = memory.get(key);
    if (!hit) {
      try {
        hit = JSON.parse(await readFile(fileFor(key), 'utf8'));
        memory.set(key, hit);
      } catch { /* no disk entry */ }
    }
    if (hit && now - hit.at < ttlMs) return { data: hit.data, fetchedAt: hit.at, fromCache: true };
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const data = await producer();
    const entry = { at: Date.now(), data };
    memory.set(key, entry);
    await mkdir(DIR, { recursive: true });
    await writeFile(fileFor(key), JSON.stringify(entry)).catch(() => {});
    return { data, fetchedAt: entry.at, fromCache: false };
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function clearCache() {
  memory.clear();
  await rm(DIR, { recursive: true, force: true });
}
