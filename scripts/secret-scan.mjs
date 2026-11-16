#!/usr/bin/env node
/**
 * Fails if tracked files contain private-network markers, token-like strings,
 * or unexpected +7 phones. Optional extra denylist: SCAN_DENYLIST (comma or
 * newline separated; set via Actions secret, never committed).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const history = process.argv.includes('--history');

const LAN = /192\.168\.|10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/;
const TOKENISH =
  /\b(?:ghp_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_\-]{20,}\b|\b[A-Fa-f0-9]{64}\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;

/** Fictional phones allowed in fixtures and docs. */
const FICTIONAL_PHONE =
  /\+7[\s-]*900[\s-]*000[\s-]*00[\s-]*0[01]|\+7900000000[01]/;

function denylistFromEnv() {
  const raw = process.env.SCAN_DENYLIST || '';
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

function listFiles() {
  if (history) {
    const out = execFileSync('git', ['rev-list', '--all'], { encoding: 'utf8' }).trim();
    if (!out) return [];
    const commits = out.split(/\r?\n/);
    /** @type {Set<string>} */
    const hits = new Set();
    for (const c of commits) {
      const names = execFileSync('git', ['ls-tree', '-r', '--name-only', c], { encoding: 'utf8' })
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      for (const n of names) hits.add(`${c}:${n}`);
    }
    return [...hits];
  }
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((n) => `WORKTREE:${n}`);
}

function readEntry(entry) {
  const i = entry.indexOf(':');
  const rev = entry.slice(0, i);
  const file = entry.slice(i + 1);
  if (rev === 'WORKTREE') {
    return fs.readFileSync(path.join(root, file), 'utf8');
  }
  return execFileSync('git', ['show', `${rev}:${file}`], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

const skipExt = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|pdf|lock)$/i;
const deny = denylistFromEnv();
/** @type {string[]} */
const findings = [];

for (const entry of listFiles()) {
  const file = entry.slice(entry.indexOf(':') + 1);
  if (skipExt.test(file)) continue;
  if (file === 'scripts/secret-scan.mjs') continue;
  let text;
  try {
    text = readEntry(entry);
  } catch {
    continue;
  }
  if (LAN.test(text)) findings.push(`${entry}: private network address`);
  if (TOKENISH.test(text)) findings.push(`${entry}: token-like string`);
  // Full +7 numbers only (mask text like "+7" alone is fine).
  const phones = text.match(/\+7[\s-]?(?:\d[\s-]*){10}/g) || [];
  for (const phone of phones) {
    if (!FICTIONAL_PHONE.test(phone)) {
      findings.push(`${entry}: unexpected +7 phone`);
      break;
    }
  }
  for (const needle of deny) {
    if (text.includes(needle)) findings.push(`${entry}: denylist hit`);
  }
}

if (findings.length) {
  console.error('secret-scan FAILED:');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}

const extra = deny.length ? `, denylist=${deny.length}` : '';
console.log(`secret-scan OK (${history ? 'full history' : 'tracked files'}${extra})`);
