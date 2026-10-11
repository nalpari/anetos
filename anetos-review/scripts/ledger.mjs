#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = 1;
export const DIR = '.review';

export class LedgerError extends Error {}

export function normFile(file) {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function findingId(source, file, symbol) {
  const hash = createHash('sha1')
    .update(`${source}|${normFile(file)}|${symbol}`)
    .digest('hex');
  return `F-${hash.slice(0, 8)}`;
}

export function init(root, pluginRoot) {
  const dir = path.join(root, DIR);
  if (fs.existsSync(dir)) return { created: false };
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(pluginRoot, 'rules', 'default.md'), path.join(dir, 'rules.md'));
  fs.writeFileSync(
    path.join(dir, 'findings.json'),
    JSON.stringify({ version: VERSION, findings: [] }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'decisions.md'), '# 결정 기록\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.tmp\n');
  return { created: true };
}

function ledgerPath(root) {
  return path.join(root, DIR, 'findings.json');
}

export function loadLedger(root) {
  const file = ledgerPath(root);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new LedgerError(`원장이 없습니다: ${file}. 먼저 init 을 실행하세요.`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new LedgerError(`findings.json 을 읽을 수 없습니다: ${e.message}`);
  }
  if (!data || data.version !== VERSION || !Array.isArray(data.findings)) {
    throw new LedgerError(`findings.json 의 형식이 맞지 않습니다 (version ${VERSION} 필요).`);
  }
  return data;
}

export function saveLedger(root, ledger) {
  const file = ledgerPath(root);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function list(ledger, { files, status } = {}) {
  const wanted = files && new Set(files.map(normFile));
  return ledger.findings.filter(
    (f) => (!wanted || wanted.has(f.file)) && (!status || f.status === status),
  );
}

const CATEGORIES = ['bug', 'security', 'data-loss', 'concurrency'];

function validateResults(ledger, results) {
  if (!results || typeof results !== 'object') return ['결과가 객체가 아닙니다'];
  const errors = [];
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  if (!filled(results.commit)) errors.push('commit: 비어 있지 않은 문자열이어야 합니다');
  for (const key of ['rechecks', 'violations', 'candidates']) {
    if (!Array.isArray(results[key])) errors.push(`${key}: 배열이어야 합니다`);
  }
  if (errors.length) return errors;

  const statusById = new Map(ledger.findings.map((f) => [f.id, f.status]));
  const checkHit = (hit, at) => {
    for (const key of ['file', 'symbol', 'title', 'evidence']) {
      if (!filled(hit[key])) errors.push(`${at}: ${key} 가 비어 있습니다`);
    }
    if (hit.matches != null && !statusById.has(hit.matches)) {
      errors.push(`${at}: matches 가 원장에 없는 id 를 가리킵니다 (${hit.matches})`);
    }
  };

  results.rechecks.forEach((r, i) => {
    const at = `rechecks[${i}]`;
    if (!statusById.has(r.id)) errors.push(`${at}: 원장에 없는 id 입니다 (${r.id})`);
    else if (statusById.get(r.id) !== 'open') {
      errors.push(`${at}: ${r.id} 의 상태가 open 이 아닙니다 (${statusById.get(r.id)})`);
    }
    if (r.verdict !== 'present' && r.verdict !== 'absent') {
      errors.push(`${at}: verdict 는 present 또는 absent 여야 합니다`);
    }
  });
  results.violations.forEach((v, i) => {
    const at = `violations[${i}]`;
    if (!/^R-\d+$/.test(v.source ?? '')) errors.push(`${at}: source 는 R-숫자 형식이어야 합니다`);
    checkHit(v, at);
  });
  results.candidates.forEach((c, i) => {
    const at = `candidates[${i}]`;
    if (!CATEGORIES.includes(c.category)) {
      errors.push(`${at}: category 는 ${CATEGORIES.join(', ')} 중 하나여야 합니다`);
    }
    if (c.verdict !== 'confirmed' && c.verdict !== 'unconfirmed') {
      errors.push(`${at}: verdict 는 confirmed 또는 unconfirmed 여야 합니다`);
    }
    checkHit(c, at);
  });
  return errors;
}

export function apply(ledger, results) {
  const errors = validateResults(ledger, results);
  if (errors.length) throw new LedgerError(`결과 형식 오류:\n- ${errors.join('\n- ')}`);

  const { commit } = results;
  const byId = new Map(ledger.findings.map((f) => [f.id, f]));
  const summary = {
    new: new Set(),
    stillOpen: new Set(),
    resolved: new Set(),
    recurred: new Set(),
    reopenRequested: new Set(),
    dismissed: new Set(),
  };

  const hits = [
    ...results.violations.map((v) => ({ ...v, confirmed: true })),
    ...results.candidates.map((c) => ({
      ...c,
      source: `explore:${c.category}`,
      confirmed: c.verdict === 'confirmed',
    })),
  ].map((h) => ({
    ...h,
    file: normFile(h.file),
    id: h.matches ?? findingId(h.source, h.file, h.symbol),
  }));
  const confirmedIds = new Set(hits.filter((h) => h.confirmed).map((h) => h.id));

  for (const r of results.rechecks) {
    const f = byId.get(r.id);
    f.lastChecked = commit;
    if (r.verdict === 'present' || confirmedIds.has(r.id)) {
      summary.stillOpen.add(r.id);
    } else {
      f.status = 'resolved';
      summary.resolved.add(r.id);
    }
  }

  for (const h of hits) {
    const f = byId.get(h.id);
    if (!f) {
      const created = {
        id: h.id,
        source: h.source,
        file: h.file,
        symbol: h.symbol,
        title: h.title,
        evidence: h.evidence,
        status: h.confirmed ? 'open' : 'dismissed',
        firstSeen: commit,
        lastChecked: commit,
        decisionId: null,
      };
      ledger.findings.push(created);
      byId.set(h.id, created);
      (h.confirmed ? summary.new : summary.dismissed).add(h.id);
      continue;
    }
    if (!h.confirmed || f.status === 'dismissed') continue;

    f.lastChecked = commit;
    f.evidence = h.evidence;
    if (f.status === 'open') {
      if (!summary.new.has(h.id) && !summary.recurred.has(h.id)) summary.stillOpen.add(h.id);
    } else if (f.status === 'resolved') {
      f.status = 'open';
      summary.recurred.add(h.id);
    } else if (f.status === 'intended' || f.status === 'rejected') {
      f.previousStatus = f.status;
      f.status = 'reopen-requested';
      summary.reopenRequested.add(h.id);
    } else if (f.status === 'reopen-requested') {
      summary.reopenRequested.add(h.id);
    }
  }

  return Object.fromEntries(Object.entries(summary).map(([key, ids]) => [key, [...ids]]));
}
