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

const DECISIONS_HEADER = '# 결정 기록\n';

// 줄을 나누는 문자. 한 줄이어야 하는 값에 들어가면 decisions.md 의 구조가 깨진다.
const LINE_BREAKS = new RegExp(`[\\r\\n\\v\\f${String.fromCharCode(0x85, 0x2028, 0x2029)}]`);
const oneLine = (text) =>
  text.trim().split(LINE_BREAKS).map((part) => part.trim()).filter(Boolean).join(' ');
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const filled = (v) => typeof v === 'string' && v.trim() !== '';

// 없는 파일만 만든다. 이미 있는 파일은 건드리지 않는다.
export function init(root, pluginRoot) {
  const dir = path.join(root, DIR);
  const created = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  const files = [
    ['rules.md', (file) => fs.copyFileSync(path.join(pluginRoot, 'rules', 'default.md'), file)],
    [
      'findings.json',
      (file) => fs.writeFileSync(file, JSON.stringify({ version: VERSION, findings: [] }, null, 2) + '\n'),
    ],
    ['decisions.md', (file) => fs.writeFileSync(file, DECISIONS_HEADER)],
    ['.gitignore', (file) => fs.writeFileSync(file, '*.tmp\n')],
  ];
  const repaired = [];
  for (const [name, write] of files) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) continue;
    write(file);
    repaired.push(name);
  }
  return created || repaired.length === 0 ? { created } : { created, repaired };
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
    data = JSON.parse(stripBom(raw));
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

export function list(ledger, { files, status, ids } = {}) {
  const wanted = files && new Set(files.map(normFile));
  const wantedIds = ids && new Set(ids);
  return ledger.findings.filter(
    (f) =>
      (!wanted || wanted.has(f.file)) &&
      (!status || f.status === status) &&
      (!wantedIds || wantedIds.has(f.id)),
  );
}

const CATEGORIES = ['bug', 'security', 'data-loss', 'concurrency'];
const STATUSES = ['open', 'resolved', 'intended', 'rejected', 'dismissed', 'reopen-requested'];

// 후보나 위반이 원장에서 어떤 ID 가 되는지, 지금 어떤 상태인지 알려 준다.
export function lookup(ledger, items) {
  if (!Array.isArray(items)) throw new LedgerError('항목의 배열이어야 합니다');
  const statusById = new Map(ledger.findings.map((f) => [f.id, f.status]));
  return items.map((item, i) => {
    const source = item?.source ?? (item?.category ? `explore:${item.category}` : null);
    if (!filled(source) || !filled(item.file) || !filled(item.symbol)) {
      throw new LedgerError(`[${i}]: source(또는 category), file, symbol 이 있어야 합니다`);
    }
    const id = findingId(source, item.file, item.symbol);
    return { id, status: statusById.get(id) ?? null };
  });
}

function validateResults(ledger, results) {
  if (!results || typeof results !== 'object') return ['결과가 객체가 아닙니다'];
  const errors = [];
  if (!filled(results.commit)) errors.push('commit: 비어 있지 않은 문자열이어야 합니다');
  for (const key of ['rechecks', 'violations', 'candidates']) {
    if (!Array.isArray(results[key])) {
      errors.push(`${key}: 배열이어야 합니다`);
      continue;
    }
    results[key].forEach((item, i) => {
      if (!item || typeof item !== 'object') errors.push(`${key}[${i}]: 객체가 아닙니다`);
    });
  }
  if (errors.length) return errors;

  const statusById = new Map(ledger.findings.map((f) => [f.id, f.status]));
  const checkHit = (hit, at) => {
    for (const key of ['file', 'symbol', 'title', 'evidence']) {
      if (!filled(hit[key])) errors.push(`${at}: ${key} 가 비어 있습니다`);
    }
    for (const key of ['file', 'symbol']) {
      if (filled(hit[key]) && LINE_BREAKS.test(hit[key])) {
        errors.push(`${at}: ${key} 에 줄바꿈이 있습니다`);
      }
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
    else if (statusById.get(r.id) !== 'open' && statusById.get(r.id) !== 'reopen-requested') {
      errors.push(
        `${at}: ${r.id} 의 상태가 open 이나 reopen-requested 가 아닙니다 (${statusById.get(r.id)})`,
      );
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

  // 같은 지적의 재확인이 여러 개 와도 순서와 상관없이 present 가 이긴다.
  const rechecked = new Map();
  for (const r of results.rechecks) {
    const seen = rechecked.get(r.id) ?? { present: false, evidence: '' };
    if (r.verdict === 'present') {
      seen.present = true;
      if (!seen.evidence && filled(r.evidence)) seen.evidence = r.evidence;
    }
    rechecked.set(r.id, seen);
  }
  for (const [id, seen] of rechecked) {
    const f = byId.get(id);
    f.lastChecked = commit;
    if (seen.present || confirmedIds.has(id)) {
      if (seen.evidence) f.evidence = seen.evidence;
      (f.status === 'open' ? summary.stillOpen : summary.reopenRequested).add(id);
    } else {
      // 재검토 요청 중이던 지적도 코드에서 사라졌으면 더 물을 것이 없다.
      f.status = 'resolved';
      delete f.previousStatus;
      summary.resolved.add(id);
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
  const required = Object.hasOwn(DECISIONS, decision) ? DECISIONS[decision] : null;
  if (!required) {
    throw new LedgerError(`알 수 없는 결정입니다: ${decision} (intended, rejected, reopen, keep 중 하나)`);
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new LedgerError('이유는 필수입니다. --reason "..." 또는 --reason-file <파일> 로 적어 주세요.');
  }
  const f = ledger.findings.find((x) => x.id === id);
  if (!f) throw new LedgerError(`원장에 없는 id 입니다: ${id}`);
  if (f.status !== required) {
    throw new LedgerError(
      `${id} 의 상태가 ${f.status} 이라 ${decision} 결정을 할 수 없습니다 (${required} 상태여야 합니다).`,
    );
  }

  const file = path.join(root, DIR, 'decisions.md');
  if (!fs.existsSync(file)) fs.writeFileSync(file, DECISIONS_HEADER);
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

  const entry = `\n## ${decisionId}\n- 날짜: ${date}\n- 지적: ${id}\n- 대상: ${oneLine(f.file)} ${oneLine(f.symbol)}\n- 결정: ${decision}\n- 이유: ${oneLine(reason)}\n`;
  // 두 파일이 어긋나지 않게 원장을 먼저 저장하고, 결정 기록에 실패하면 원장을 되돌린다.
  const previous = fs.readFileSync(ledgerPath(root), 'utf8');
  saveLedger(root, ledger);
  try {
    fs.appendFileSync(file, entry);
  } catch (e) {
    fs.writeFileSync(ledgerPath(root), previous);
    throw e;
  }
  return { decisionId, status: f.status, decision };
}

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = '사용법: ledger.mjs <init | list [--files a,b] [--status s] [--ids a,b] | id <source> <file> <symbol> | ids <항목 파일> | apply <결과 파일> | decide <id> <결정> (--reason "..." | --reason-file <파일>)>';

const OPTIONS = {
  list: ['files', 'status', 'ids'],
  decide: ['reason', 'reason-file'],
};

// --이름 값 과 --이름=값 을 모두 받는다. 모르는 옵션과 값이 빠진 옵션은 오류다.
function parseArgs(argv, allowed = []) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      pos.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!allowed.includes(name)) throw new LedgerError(`알 수 없는 옵션입니다: --${name}\n${USAGE}`);
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
    if (value === undefined) throw new LedgerError(`--${name} 에 값이 없습니다`);
    opts[name] = value;
  }
  return { pos, opts };
}

function listOption(opts, name) {
  if (opts[name] === undefined) return undefined;
  const values = opts[name].split(',').map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) throw new LedgerError(`--${name} 에 값이 없습니다`);
  return values;
}

function readJson(file, what) {
  try {
    return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    throw new LedgerError(`${what} 파일을 읽을 수 없습니다: ${e.message}`);
  }
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest, OPTIONS[cmd]);
  const root = process.cwd();
  const out = (value) => console.log(JSON.stringify(value, null, 2));

  switch (cmd) {
    case 'init':
      return out(init(root, PLUGIN_ROOT));
    case 'id':
      if (pos.length !== 3) throw new LedgerError(USAGE);
      return out({ id: findingId(pos[0], pos[1], pos[2]) });
    case 'ids':
      if (pos.length !== 1) throw new LedgerError(USAGE);
      return out(lookup(loadLedger(root), readJson(pos[0], '항목')));
    case 'list': {
      if (pos.length !== 0) throw new LedgerError(USAGE);
      if (opts.status !== undefined && !STATUSES.includes(opts.status)) {
        throw new LedgerError(`알 수 없는 상태입니다: ${opts.status} (${STATUSES.join(', ')} 중 하나)`);
      }
      return out(
        list(loadLedger(root), {
          files: listOption(opts, 'files'),
          status: opts.status,
          ids: listOption(opts, 'ids'),
        }),
      );
    }
    case 'apply': {
      if (pos.length !== 1) throw new LedgerError(USAGE);
      const results = readJson(pos[0], '결과');
      const ledger = loadLedger(root);
      const summary = apply(ledger, results, (file) => fileHash(root, file));
      saveLedger(root, ledger);
      return out(summary);
    }
    case 'decide': {
      if (pos.length !== 2) throw new LedgerError(USAGE);
      if (opts.reason !== undefined && opts['reason-file'] !== undefined) {
        throw new LedgerError('--reason 과 --reason-file 은 하나만 씁니다');
      }
      let reason = opts.reason;
      if (opts['reason-file'] !== undefined) {
        try {
          // 파일로 받으면 셸이 $, 백틱, 따옴표를 해석할 일이 없다.
          reason = stripBom(fs.readFileSync(opts['reason-file'], 'utf8'));
        } catch (e) {
          throw new LedgerError(`이유 파일을 읽을 수 없습니다: ${e.message}`);
        }
      }
      return out(decide(root, loadLedger(root), pos[0], pos[1], reason));
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
