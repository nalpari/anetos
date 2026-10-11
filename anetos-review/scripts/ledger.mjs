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

// 결정 시점의 코드를 고정하는 해시. 줄바꿈 변환만으로는 달라지지 않는다.
export function fileHash(root, file) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null;
  }
  return createHash('sha1').update(text.replace(/\r\n/g, '\n')).digest('hex');
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
    if (filled(hit.file) && (path.isAbsolute(hit.file) || /^[A-Za-z]:/.test(hit.file))) {
      errors.push(`${at}: file 은 저장소 루트 기준 상대 경로여야 합니다 (${hit.file})`);
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

export function apply(ledger, results, hashOf = () => null) {
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
    decided: new Set(),
    dismissed: new Set(),
  };

  const hits = [
    ...results.violations.map((v) => ({ ...v, confirmed: true })),
    ...results.candidates.map((c) => ({
      ...c,
      source: `explore:${c.category}`,
      confirmed: c.verdict === 'confirmed',
    })),
  ]
    .map((h) => {
      const file = normFile(h.file);
      // matches 는 같은 source, 같은 파일의 지적을 가리킬 때만 믿는다.
      const target = h.matches != null ? byId.get(h.matches) : null;
      const usable = target && target.source === h.source && target.file === file;
      return { ...h, file, id: usable ? h.matches : findingId(h.source, file, h.symbol) };
    })
    // 같은 ID 가 confirmed 와 unconfirmed 로 함께 오면 순서와 상관없이 confirmed 가 이긴다.
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed));
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
      delete f.fixLevel;
      summary.recurred.add(h.id);
    } else if (f.status === 'intended' || f.status === 'rejected') {
      // 결정 이후 파일이 그대로면 같은 논의를 다시 꺼내지 않는다.
      if (f.decidedHash && hashOf(f.file) === f.decidedHash) {
        summary.decided.add(h.id);
      } else {
        f.previousStatus = f.status;
        f.status = 'reopen-requested';
        summary.reopenRequested.add(h.id);
      }
    } else if (f.status === 'reopen-requested') {
      summary.reopenRequested.add(h.id);
    }
  }

  return Object.fromEntries(Object.entries(summary).map(([key, ids]) => [key, [...ids]]));
}

const DECISIONS = {
  intended: 'open',
  rejected: 'open',
  reopen: 'reopen-requested',
  keep: 'reopen-requested',
};

export function decide(root, ledger, id, decision, reason, date = new Date().toISOString().slice(0, 10)) {
  const required = DECISIONS[decision];
  if (!required) {
    throw new LedgerError(`알 수 없는 결정입니다: ${decision} (intended, rejected, reopen, keep 중 하나)`);
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new LedgerError('이유는 필수입니다. --reason "..." 으로 적어 주세요.');
  }
  const f = ledger.findings.find((x) => x.id === id);
  if (!f) throw new LedgerError(`원장에 없는 id 입니다: ${id}`);
  if (f.status !== required) {
    throw new LedgerError(
      `${id} 의 상태가 ${f.status} 이라 ${decision} 결정을 할 수 없습니다 (${required} 상태여야 합니다).`,
    );
  }

  const file = path.join(root, DIR, 'decisions.md');
  const text = fs.readFileSync(file, 'utf8');
  const numbers = [...text.matchAll(/^## D-(\d+)\s*$/gm)].map((m) => Number(m[1]));
  const decisionId = `D-${String(Math.max(0, ...numbers) + 1).padStart(4, '0')}`;

  if (decision === 'intended' || decision === 'rejected') {
    f.status = decision;
  } else {
    f.status = decision === 'reopen' ? 'open' : f.previousStatus;
    delete f.previousStatus;
  }
  f.decisionId = decisionId;
  if (decision === 'reopen') delete f.decidedHash;
  else f.decidedHash = fileHash(root, f.file);

  const oneLine = reason.trim().replace(/\s*[\r\n]+\s*/g, ' ');
  const entry = `\n## ${decisionId}\n- 날짜: ${date}\n- 지적: ${id}\n- 대상: ${f.file} ${f.symbol}\n- 결정: ${decision}\n- 이유: ${oneLine}\n`;
  // 두 파일이 어긋나지 않게 원장을 먼저 저장하고, 결정 기록에 실패하면 원장을 되돌린다.
  const previous = fs.readFileSync(ledgerPath(root), 'utf8');
  saveLedger(root, ledger);
  try {
    fs.appendFileSync(file, entry);
  } catch (e) {
    fs.writeFileSync(ledgerPath(root), previous);
    throw e;
  }
  return { decisionId, status: f.status };
}

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = '사용법: ledger.mjs <init | list [--files a,b] [--status s] | id <source> <file> <symbol> | apply <결과 파일> | decide <id> <결정> --reason "...">';

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opts };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest);
  const root = process.cwd();
  const out = (value) => console.log(JSON.stringify(value, null, 2));

  switch (cmd) {
    case 'init':
      return out(init(root, PLUGIN_ROOT));
    case 'id':
      if (pos.length !== 3) throw new LedgerError(USAGE);
      return out({ id: findingId(pos[0], pos[1], pos[2]) });
    case 'list':
      return out(
        list(loadLedger(root), {
          files: opts.files?.split(',').filter(Boolean),
          status: opts.status,
        }),
      );
    case 'apply': {
      if (pos.length !== 1) throw new LedgerError(USAGE);
      let results;
      try {
        results = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
      } catch (e) {
        throw new LedgerError(`결과 파일을 읽을 수 없습니다: ${e.message}`);
      }
      const ledger = loadLedger(root);
      const summary = apply(ledger, results, (file) => fileHash(root, file));
      saveLedger(root, ledger);
      return out(summary);
    }
    case 'decide': {
      if (pos.length !== 2) throw new LedgerError(USAGE);
      return out(decide(root, loadLedger(root), pos[0], pos[1], opts.reason));
    }
    default:
      throw new LedgerError(USAGE);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof LedgerError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}
