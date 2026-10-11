#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIR, LedgerError, fileHash, loadLedger, saveLedger } from './ledger.mjs';

const CONFIG_VERSION = 1;
const KINDS = ['test', 'static'];

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return ['설정이 객체가 아닙니다'];
  const errors = [];
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  if (cfg.version !== CONFIG_VERSION) errors.push(`version: ${CONFIG_VERSION} 이어야 합니다`);
  if (!Array.isArray(cfg.testPaths) || !cfg.testPaths.every(filled)) {
    errors.push('testPaths: 비어 있지 않은 문자열의 배열이어야 합니다');
  }
  if (!Array.isArray(cfg.checks)) {
    errors.push('checks: 배열이어야 합니다');
    return errors;
  }
  const names = new Set();
  cfg.checks.forEach((c, i) => {
    const at = `checks[${i}]`;
    if (!c || typeof c !== 'object') {
      errors.push(`${at}: 객체가 아닙니다`);
      return;
    }
    if (!filled(c.name)) errors.push(`${at}: name 이 비어 있습니다`);
    else if (names.has(c.name)) errors.push(`${at}: name 이 겹칩니다 (${c.name})`);
    else names.add(c.name);
    if (!KINDS.includes(c.kind)) errors.push(`${at}: kind 는 test 또는 static 이어야 합니다`);
    if (!filled(c.command)) errors.push(`${at}: command 가 비어 있습니다`);
    if (c.timeoutSec !== undefined && !(typeof c.timeoutSec === 'number' && c.timeoutSec > 0)) {
      errors.push(`${at}: timeoutSec 는 0보다 큰 수여야 합니다`);
    }
  });
  return errors;
}

function configPath(root) {
  return path.join(root, DIR, 'config.json');
}

export function loadConfig(root) {
  let raw;
  try {
    raw = fs.readFileSync(configPath(root), 'utf8');
  } catch {
    throw new LedgerError('검증 설정이 없습니다. /anetos-review:review-config 를 먼저 실행하세요.');
  }
  let cfg;
  try {
    cfg = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new LedgerError(`config.json 을 읽을 수 없습니다: ${e.message}`);
  }
  const errors = validateConfig(cfg);
  if (errors.length) throw new LedgerError(`config.json 형식 오류:\n- ${errors.join('\n- ')}`);
  return cfg;
}

export function saveConfig(root, cfg) {
  const errors = validateConfig(cfg);
  if (errors.length) throw new LedgerError(`설정 형식 오류:\n- ${errors.join('\n- ')}`);
  if (!fs.existsSync(path.join(root, DIR))) {
    throw new LedgerError(`${DIR}/ 가 없습니다. 먼저 /anetos-review:review 를 실행하세요.`);
  }
  fs.writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + '\n');
  return cfg;
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function isTestPath(cfg, file) {
  return cfg.testPaths.some((glob) => globToRegExp(glob).test(file));
}

const TAIL_LINES = 40;
const DEFAULT_TIMEOUT_SEC = 600;
const TIMEOUT_EXIT = 124;
const SELF = fileURLToPath(import.meta.url);

// 검사 명령을 감싸서 실행하는 내부 명령(__run). 제한 시간을 넘기면 셸만이 아니라
// 그 아래 프로세스까지 끝낸다. 남은 테스트 러너가 다음 단계와 겹쳐 돌면 안 된다.
function runGuarded(command, timeoutMs) {
  const windows = process.platform === 'win32';
  const child = spawn(command, { shell: true, stdio: 'inherit', detached: !windows, windowsHide: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (windows) {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // 이미 끝났다.
      }
    }
  }, timeoutMs);
  child.on('error', () => process.exit(1));
  child.on('exit', (code) => {
    clearTimeout(timer);
    process.exit(timedOut ? TIMEOUT_EXIT : code ?? 1);
  });
}

export function runCheck(root, check) {
  const timeoutMs = (check.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const r = spawnSync(process.execPath, [SELF, '__run', check.command, String(timeoutMs)], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    name: check.name,
    kind: check.kind,
    result: r.status === 0 && !r.error ? 'pass' : 'fail',
    timedOut: r.status === TIMEOUT_EXIT,
    tail: output.trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join('\n'),
  };
}

export function runChecks(root, cfg) {
  return cfg.checks.map((check) => runCheck(root, check));
}

export function compare(baseline, current) {
  const before = new Map(baseline.map((b) => [b.name, b.result]));
  return current.map((c) => {
    const was = before.get(c.name) ?? 'pass';
    const verdict =
      was === 'pass'
        ? c.result === 'pass' ? 'kept' : 'regressed'
        : c.result === 'pass' ? 'improved' : 'masked';
    return { name: c.name, kind: c.kind, verdict, tail: c.tail };
  });
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    const name = args.find((a) => !a.startsWith('-')) ?? args[0];
    throw new LedgerError(`git ${name} 실패: ${(r.stderr || r.error?.message || '').trim()}`);
  }
  return r.stdout;
}

const inReview = (file) => file === DIR || file.startsWith(`${DIR}/`);

// 추적 파일의 변경과 미추적 파일. .review/ 아래는 뺀다.
function workingChanges(root) {
  const parts = git(root, ['status', '--porcelain', '-z', '--untracked-files=all'])
    .split('\0')
    .filter(Boolean);
  const tracked = [];
  const untracked = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    const files = [parts[i].slice(3)];
    // 이름 변경과 복사는 원래 경로가 다음 항목으로 온다.
    if (code[0] === 'R' || code[0] === 'C') {
      const from = parts[++i];
      if (code[0] === 'R') files.push(from);
    }
    for (const file of files) {
      if (inReview(file)) continue;
      (code === '??' ? untracked : tracked).push(file);
    }
  }
  return { tracked, untracked };
}

// HEAD 와 다른 모든 파일(.review/ 제외)과 그 내용의 해시. 지워진 파일의 해시는 null 이다.
function snapshot(root) {
  const { tracked, untracked } = workingChanges(root);
  return Object.fromEntries(
    [...new Set([...tracked, ...untracked])].map((file) => [file, fileHash(root, file)]),
  );
}

function statePath(root) {
  return path.join(root, DIR, 'fix.tmp');
}

function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(root, state) {
  const file = statePath(root);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

const headOf = (root) => git(root, ['rev-parse', 'HEAD']).trim();

function requireState(root, stages) {
  const state = readState(root);
  if (!state || !stages.includes(state.stage)) {
    throw new LedgerError(
      `단계를 건너뛸 수 없습니다. 지금 단계는 ${state?.stage ?? '시작 전'} 이고, ${stages.join(' 또는 ')} 단계여야 합니다.`,
    );
  }
  if (headOf(root) !== state.head) {
    throw new LedgerError(
      '수정을 시작한 뒤 커밋이 생겨 HEAD 가 바뀌었습니다. 기준선이 더 이상 맞지 않으니 abort 한 뒤 다시 시작하세요.',
    );
  }
  return state;
}

// 수정이 바꾸거나 만든 파일과 그 해시. state.known 은 수정과 무관하다고 알려진 내용이다:
// 시작 전부터 있던 미추적 파일, 그리고 검사가 만들거나 고친 파일.
function changedSince(root, state) {
  return Object.fromEntries(
    Object.entries(snapshot(root)).filter(([file, hash]) => state.known[file] !== hash),
  );
}

// run 을 실행하는 동안 내용이 달라진 파일은 검사가 한 일이므로 known 에 기록한다.
function tracking(root, state, run) {
  const before = snapshot(root);
  const result = run();
  for (const [file, hash] of Object.entries(snapshot(root))) {
    if (before[file] !== hash) state.known[file] = hash;
  }
  return result;
}

export function start(root, id, log = () => {}) {
  const cfg = loadConfig(root);
  const finding = loadLedger(root).findings.find((f) => f.id === id);
  if (!finding) throw new LedgerError(`원장에 없는 id 입니다: ${id}`);
  if (finding.status !== 'open') {
    throw new LedgerError(`${id} 의 상태가 ${finding.status} 입니다. open 인 지적만 고칠 수 있습니다.`);
  }
  if (fs.existsSync(statePath(root))) {
    throw new LedgerError('진행 중인 수정이 있습니다. 먼저 finish 하거나 abort 하세요.');
  }
  const head = headOf(root);
  if (git(root, ['rev-parse', '--show-prefix']).trim() !== '') {
    throw new LedgerError('git 저장소의 최상위 폴더에서 실행해야 합니다.');
  }
  if (spawnSync('git', ['check-ignore', '-q', `${DIR}/findings.json`], { cwd: root }).status === 0) {
    throw new LedgerError(
      `${DIR}/ 가 .gitignore 에 걸려 있어 원장을 커밋할 수 없습니다. .gitignore 에서 빼고 ${DIR}/ 를 커밋한 뒤 다시 실행하세요.`,
    );
  }
  const dirty = workingChanges(root).tracked;
  if (dirty.length) {
    throw new LedgerError(
      `커밋하지 않은 변경이 있어 시작할 수 없습니다: ${dirty.join(', ')}. 커밋하거나 치워 둔 뒤 다시 실행하세요.`,
    );
  }
  // 대소문자를 구분하지 않는 파일 시스템에서는 원장의 경로와 git 의 경로가 대소문자만 다를 수 있다.
  // git 이 아는 표기를 대상 경로로 쓴다.
  const ignoreCase =
    spawnSync('git', ['config', '--get', 'core.ignorecase'], { cwd: root, encoding: 'utf8' })
      .stdout.trim() === 'true';
  const magic = ignoreCase ? ':(icase,literal)' : ':(literal)';
  const target = git(root, ['ls-files', '-z', '--', `${magic}${finding.file}`])
    .split('\0')
    .filter(Boolean)[0];
  if (!target) {
    throw new LedgerError(
      `${finding.file} 이 git 에 추적되지 않습니다. 되돌릴 기준이 없으므로 먼저 커밋한 뒤 다시 실행하세요.`,
    );
  }

  for (const check of cfg.checks) log(`검사 실행: ${check.name} → ${check.command}`);
  const baseline = runChecks(root, cfg);
  // 기준선 실행 뒤에 기록해서 검사가 만든 파일도 "원래 있던 것"이 되게 한다.
  // 설정도 여기서 고정한다. 도중에 config.json 이 바뀌어도 판정 기준은 바뀌지 않는다.
  writeState(root, {
    id, head, target, config: cfg, known: snapshot(root), baseline,
    stage: 'started', repro: false, testHashes: {}, result: null,
  });
  return {
    id,
    baseline: baseline.map(({ name, kind, result }) => ({ name, kind, result })),
    masked: baseline.filter((b) => b.result === 'fail').map((b) => b.name),
  };
}

export function abort(root) {
  const state = readState(root);
  if (!state) {
    // 읽을 수 없는 상태 파일은 되돌릴 근거가 못 된다. 지워서 다시 시작할 수 있게만 한다.
    if (!fs.existsSync(statePath(root))) return { aborted: false };
    fs.rmSync(statePath(root), { force: true });
    return { aborted: false, removedCorruptState: true };
  }

  // 도중에 생긴 커밋은 사용자의 것일 수 있으므로 되돌리지 않고 알리기만 한다.
  const headMoved = headOf(root) !== state.head;
  const exclude = `:(exclude)${DIR}`;
  git(root, ['reset', '-q', '--', '.', exclude]);
  git(root, ['checkout', '--', '.', exclude]);
  // 남은 것은 미추적 파일뿐이다. 수정이 만든 것은 지우고, 원래 있던 파일을 수정이 바꾼 경우는
  // 되돌릴 기준이 없으므로 알리기만 한다.
  const top = path.resolve(root);
  const unrestored = [];
  for (const [file, hash] of Object.entries(snapshot(root))) {
    if (file in state.known) {
      if (state.known[file] !== hash) unrestored.push(file);
      continue;
    }
    fs.rmSync(path.join(top, file), { force: true });
    // 파일을 지워서 비게 된 폴더도 지운다. 비어 있지 않으면 rmdir 이 실패하고 거기서 멈춘다.
    for (let dir = path.dirname(path.join(top, file)); dir !== top; dir = path.dirname(dir)) {
      try {
        fs.rmdirSync(dir);
      } catch {
        break;
      }
    }
  }

  const ledger = loadLedger(root);
  const finding = ledger.findings.find((f) => f.id === state.id);
  if (finding) {
    finding.fixAttempts = (finding.fixAttempts ?? 0) + 1;
    saveLedger(root, ledger);
  }
  fs.rmSync(statePath(root), { force: true });
  return { aborted: true, id: state.id, fixAttempts: finding?.fixAttempts ?? 0, unrestored, headMoved };
}

// 기준선과 비교하고, 회귀로 나온 검사는 한 번 다시 실행해 불안정한 검사를 가려낸다.
function evaluate(root, state) {
  const cfg = state.config;
  return tracking(root, state, () =>
    compare(state.baseline, runChecks(root, cfg)).map((v) => {
      if (v.verdict !== 'regressed') return v;
      const again = runCheck(root, cfg.checks.find((c) => c.name === v.name));
      return again.result === 'pass' ? { ...v, verdict: 'flaky' } : v;
    }),
  );
}

function brief(verdicts) {
  return verdicts.map((v) =>
    v.verdict === 'regressed' ? v : { name: v.name, kind: v.kind, verdict: v.verdict },
  );
}

export function stageRed(root, repro) {
  const state = requireState(root, ['started', 'red']);
  const verdicts = evaluate(root, state);
  const changed = changedSince(root, state);
  const regressed = verdicts.filter((v) => v.verdict === 'regressed');
  const testRegressed = regressed.some((v) => v.kind === 'test');

  const reasons = [];
  if (Object.keys(changed).some((file) => !isTestPath(state.config, file))) {
    reasons.push('non-test-file-changed');
  }
  if (regressed.some((v) => v.kind === 'static')) reasons.push('static-regression');
  if (repro && !testRegressed) reasons.push('repro-not-failing');
  if (!repro && testRegressed) reasons.push('unexpected-regression');

  const ok = reasons.length === 0;
  if (ok) {
    state.stage = 'red';
    state.repro = repro;
    state.testHashes = changed;
  }
  writeState(root, state);
  return { ok, reasons, verdicts: ok ? brief(verdicts) : verdicts };
}

export function stageFixed(root, recheck) {
  const state = requireState(root, ['red', 'fixed']);
  const { target } = state;
  const verdicts = evaluate(root, state);
  const changed = changedSince(root, state);
  // 빨강 단계에서 쓴 테스트를 뺀 나머지가 수정 단계에서 바뀐 파일이다.
  const fixFiles = Object.keys(changed).filter((file) => !(file in state.testHashes));

  const reasons = [];
  if (verdicts.some((v) => v.verdict === 'regressed')) reasons.push('regression');
  if (recheck !== 'absent') reasons.push('finding-present');
  if (Object.entries(state.testHashes).some(([file, hash]) => changed[file] !== hash)) {
    reasons.push('tests-changed');
  }
  if (fixFiles.length === 0) reasons.push('nothing-fixed');

  // 대상 파일이 아니면 전부 범위 밖이다. 수정 단계에서 손댄 기존 테스트 파일도 포함한다.
  const outOfScope = fixFiles.filter((file) => file !== target);
  const level = state.repro
    ? 'reproduced'
    : // 기준선에서 통과하던 검사가 지금도 통과해야 회귀가 없다는 근거가 된다.
      // 기준선에서 실패하던 검사(masked, improved)는 근거가 못 된다.
      verdicts.some((v) => v.verdict === 'kept' || v.verdict === 'flaky') ? 'guarded' : 'unverified';

  const ok = reasons.length === 0;
  state.stage = ok ? 'fixed' : 'red';
  state.result = { ok, level, outOfScope, verified: changed };
  writeState(root, state);
  return { ok, reasons, level, outOfScope, verdicts: ok ? brief(verdicts) : verdicts };
}

const sortedJson = (obj) => JSON.stringify(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));

export function finish(root, { allowUnverified = false, allowOutOfScope = false } = {}) {
  const state = requireState(root, ['fixed']);
  if (!state.result?.ok) throw new LedgerError('단계를 건너뛸 수 없습니다. 통과한 stage fixed 가 없습니다.');
  const { level, outOfScope, verified } = state.result;
  if (level === 'unverified' && !allowUnverified) {
    throw new LedgerError('검증 불가 수정입니다. 사용자가 승인한 경우에만 --allow-unverified 로 마무리하세요.');
  }
  if (outOfScope.length && !allowOutOfScope) {
    throw new LedgerError(
      `범위 밖 파일이 바뀌었습니다: ${outOfScope.join(', ')}. 사용자가 승인한 경우에만 --allow-out-of-scope 로 마무리하세요.`,
    );
  }
  // 커밋되는 것은 stage fixed 가 확인한 내용 그대로여야 한다.
  if (sortedJson(changedSince(root, state)) !== sortedJson(verified)) {
    throw new LedgerError('stage fixed 이후 파일이 바뀌었습니다. stage fixed 를 다시 실행하세요.');
  }

  const ledger = loadLedger(root);
  const finding = ledger.findings.find((f) => f.id === state.id);
  if (!finding || finding.status !== 'open') {
    throw new LedgerError(`${state.id} 가 원장에서 open 상태가 아닙니다.`);
  }
  const ledgerRel = `${DIR}/findings.json`;
  const ledgerFile = path.join(root, ledgerRel);
  const previous = fs.readFileSync(ledgerFile, 'utf8');

  finding.status = 'resolved';
  finding.fixLevel = level;
  saveLedger(root, ledger);

  const title = finding.title.replace(/\s+/g, ' ').trim();
  try {
    // .review/ 에서는 원장만 커밋한다. 사용자가 커밋하지 않은 규칙이나 설정 변경을 끌고 들어가지 않는다.
    git(root, ['--literal-pathspecs', 'add', '-A', '--', ...Object.keys(verified), ledgerRel]);
    git(root, ['commit', '-q', '-m', `fix(review): ${title} [${finding.id}]`]);
  } catch (e) {
    // 커밋 훅 실패 등. 원장과 스테이징만 되돌리고 작업 트리는 남겨 원인을 볼 수 있게 한다.
    fs.writeFileSync(ledgerFile, previous);
    spawnSync('git', ['reset', '-q'], { cwd: root });
    throw e;
  }
  fs.rmSync(statePath(root), { force: true });
  return { id: finding.id, level, commit: git(root, ['rev-parse', '--short', 'HEAD']).trim() };
}

const USAGE =
  '사용법: fix.mjs <config show | config set <파일> | start <ID> | stage red --repro <yes|no> | stage fixed --recheck <absent|present> | finish [--allow-unverified] [--allow-out-of-scope] | abort>';

function main(argv) {
  const root = process.cwd();
  const out = (value) => console.log(JSON.stringify(value, null, 2));
  const option = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const [cmd, sub, arg] = argv;

  if (cmd === '__run') return runGuarded(sub, Number(arg));
  if (cmd === 'config' && sub === 'show') return out(loadConfig(root));
  if (cmd === 'config' && sub === 'set' && arg) {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(arg, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      throw new LedgerError(`설정 파일을 읽을 수 없습니다: ${e.message}`);
    }
    return out(saveConfig(root, cfg));
  }
  if (cmd === 'start' && sub) return out(start(root, sub, (line) => console.error(line)));
  if (cmd === 'stage' && sub === 'red') {
    const repro = option('--repro');
    if (repro !== 'yes' && repro !== 'no') throw new LedgerError(USAGE);
    return out(stageRed(root, repro === 'yes'));
  }
  if (cmd === 'stage' && sub === 'fixed') {
    const recheck = option('--recheck');
    if (recheck !== 'absent' && recheck !== 'present') throw new LedgerError(USAGE);
    return out(stageFixed(root, recheck));
  }
  if (cmd === 'finish') {
    return out(
      finish(root, {
        allowUnverified: argv.includes('--allow-unverified'),
        allowOutOfScope: argv.includes('--allow-out-of-scope'),
      }),
    );
  }
  if (cmd === 'abort') return out(abort(root));
  throw new LedgerError(USAGE);
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
