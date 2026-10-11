import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LedgerError, findingId, init, loadLedger, saveLedger } from './ledger.mjs';
import {
  validateConfig, loadConfig, saveConfig, globToRegExp, isTestPath,
  runCheck, compare,
  start, abort,
  stageRed, stageFixed,
  finish,
} from './fix.mjs';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fix-'));
}

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function validConfig(over = {}) {
  return {
    version: 1,
    checks: [{ name: 'test', kind: 'test', command: 'node --test', timeoutSec: 600 }],
    testPaths: ['test/**'],
    ...over,
  };
}

test('validateConfig: 올바른 설정은 오류가 없다', () => {
  assert.deepEqual(validateConfig(validConfig()), []);
  assert.deepEqual(validateConfig(validConfig({ checks: [] })), []);
  assert.deepEqual(
    validateConfig(validConfig({ checks: [{ name: 'lint', kind: 'static', command: 'x' }] })),
    [],
  );
});

test('validateConfig: 틀린 항목을 위치와 함께 알려준다', () => {
  const check = (over) => ({ name: 'test', kind: 'test', command: 'x', ...over });
  const cases = [
    [null, /객체/],
    [validConfig({ version: 2 }), /version/],
    [validConfig({ checks: 'x' }), /checks/],
    [validConfig({ testPaths: [''] }), /testPaths/],
    [validConfig({ checks: [check({ name: '' })] }), /checks\[0\].*name/],
    [validConfig({ checks: [check(), check()] }), /checks\[1\].*겹칩니다/],
    [validConfig({ checks: [check({ kind: 'unit' })] }), /checks\[0\].*kind/],
    [validConfig({ checks: [check({ command: ' ' })] }), /checks\[0\].*command/],
    [validConfig({ checks: [check({ timeoutSec: 0 })] }), /checks\[0\].*timeoutSec/],
  ];
  for (const [cfg, pattern] of cases) {
    assert.match(validateConfig(cfg).join('\n'), pattern);
  }
});

test('saveConfig 후 loadConfig 는 같은 내용을 돌려주고, 틀린 설정은 쓰지 않는다', () => {
  const root = tmpDir();
  init(root, PLUGIN_ROOT);
  saveConfig(root, validConfig());
  assert.deepEqual(loadConfig(root), validConfig());
  assert.throws(() => saveConfig(root, validConfig({ version: 9 })), LedgerError);
  assert.deepEqual(loadConfig(root), validConfig());
});

test('loadConfig: 설정이 없거나 깨졌으면 LedgerError', () => {
  const root = tmpDir();
  init(root, PLUGIN_ROOT);
  assert.throws(() => loadConfig(root), /review-config/);
  write(root, '.review/config.json', '{ 깨짐');
  assert.throws(() => loadConfig(root), LedgerError);
});

test('isTestPath: glob 이 디렉터리 경계를 지킨다', () => {
  const cfg = validConfig({ testPaths: ['**/*.test.*', 'test/**', 'spec/?.js'] });
  for (const file of ['a.test.js', 'src/deep/a.test.ts', 'test/a.js', 'test/x/y/새 파일.js', 'spec/a.js']) {
    assert.equal(isTestPath(cfg, file), true, file);
  }
  for (const file of ['src/a.js', 'src/test.js', 'contest/a.js', 'spec/ab.js', 'spec/x/a.js']) {
    assert.equal(isTestPath(cfg, file), false, file);
  }
  assert.equal(globToRegExp('a.b').test('axb'), false);
});

const HELPERS = tmpDir();

function helper(name, code) {
  const file = path.join(HELPERS, name);
  fs.writeFileSync(file, code);
  return `node "${file}"`;
}

const PASS = helper('pass.js', "console.log('ok');process.exit(0);");
const FAIL = helper('fail.js', "console.error('boom');process.exit(1);");

test('runCheck: 종료 코드 0 은 pass, 그 외는 fail', () => {
  const root = tmpDir();
  const pass = runCheck(root, { name: 'a', kind: 'test', command: PASS });
  assert.deepEqual(
    { name: pass.name, kind: pass.kind, result: pass.result, timedOut: pass.timedOut },
    { name: 'a', kind: 'test', result: 'pass', timedOut: false },
  );
  const fail = runCheck(root, { name: 'b', kind: 'static', command: FAIL });
  assert.equal(fail.result, 'fail');
  assert.match(fail.tail, /boom/);
});

test('runCheck: 출력은 마지막 40줄만 남긴다', () => {
  const cmd = helper('lines.js', "for(let i=1;i<=100;i++)console.log('line'+i);");
  const lines = runCheck(tmpDir(), { name: 'a', kind: 'test', command: cmd }).tail.split('\n');
  assert.ok(lines.length <= 40);
  assert.ok(lines.includes('line100'));
  assert.equal(lines.includes('line50'), false);
});

test('runCheck: 출력이 커도 통과한 검사는 pass 다', () => {
  const cmd = helper('big.js', "process.stdout.write('x'.repeat(3*1024*1024)+'\\n');");
  assert.equal(runCheck(tmpDir(), { name: 'a', kind: 'test', command: cmd }).result, 'pass');
});

test('runCheck: 제한 시간을 넘기면 fail 이다', () => {
  const cmd = helper('slow.js', 'setTimeout(()=>process.exit(0),3000);');
  const r = runCheck(tmpDir(), { name: 'a', kind: 'test', command: cmd, timeoutSec: 0.5 });
  assert.equal(r.result, 'fail');
  assert.equal(r.timedOut, true);
});

test('compare: 기준선 대비 네 가지 판정', () => {
  const r = (name, result) => ({ name, kind: 'test', result, timedOut: false, tail: `${name}:${result}` });
  const verdicts = compare(
    [r('a', 'pass'), r('b', 'pass'), r('c', 'fail'), r('d', 'fail')],
    [r('a', 'pass'), r('b', 'fail'), r('c', 'fail'), r('d', 'pass')],
  );
  assert.deepEqual(
    verdicts.map((v) => [v.name, v.verdict]),
    [['a', 'kept'], ['b', 'regressed'], ['c', 'masked'], ['d', 'improved']],
  );
  assert.equal(verdicts[1].tail, 'b:fail');
});

// src/a.js 에 BROKEN 이 있거나, 테스트 파일에 REPRO 가 있는데 src/a.js 에 FIXED 가 없으면 실패한다.
const SUITE = helper(
  'suite.js',
  [
    "const fs=require('fs');",
    "const src=fs.readFileSync('src/a.js','utf8');",
    "const t=fs.existsSync('test/a.test.js')?fs.readFileSync('test/a.test.js','utf8'):'';",
    "console.log('suite ran');",
    "if(src.includes('BROKEN'))process.exit(1);",
    "if(t.includes('REPRO')&&!src.includes('FIXED'))process.exit(1);",
    'process.exit(0);',
  ].join('\n'),
);

const FID = findingId('R-001', 'src/a.js', 'foo');

function g(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function makeRepo({ checks, status = 'open', title = '제목' } = {}) {
  const root = tmpDir();
  g(root, 'init', '-q');
  g(root, 'config', 'user.email', 't@example.com');
  g(root, 'config', 'user.name', 't');
  g(root, 'config', 'commit.gpgsign', 'false');
  g(root, 'config', 'core.autocrlf', 'false');
  write(root, 'src/a.js', 'function foo() {}\n');
  init(root, PLUGIN_ROOT);
  saveLedger(root, {
    version: 1,
    findings: [
      {
        id: FID, source: 'R-001', file: 'src/a.js', symbol: 'foo', title,
        evidence: 'src/a.js:1', status, firstSeen: 'c0', lastChecked: 'c0', decisionId: null,
      },
    ],
  });
  saveConfig(root, {
    version: 1,
    checks: checks ?? [{ name: 'test', kind: 'test', command: SUITE }],
    testPaths: ['test/**'],
  });
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', 'init');
  return root;
}

function readStateFile(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.review', 'fix.tmp'), 'utf8'));
}

function statusOutsideReview(root) {
  return g(root, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter((line) => line && !line.includes('.review/'))
    .sort();
}

test('start: 기준선을 실행하고 가려진 검사를 알려준다', () => {
  const root = makeRepo({
    checks: [
      { name: 'test', kind: 'test', command: SUITE },
      { name: 'lint', kind: 'static', command: FAIL },
    ],
  });
  const logged = [];
  const result = start(root, FID, (line) => logged.push(line));
  assert.deepEqual(result, {
    id: FID,
    baseline: [
      { name: 'test', kind: 'test', result: 'pass' },
      { name: 'lint', kind: 'static', result: 'fail' },
    ],
    masked: ['lint'],
  });
  assert.equal(logged.length, 2);
  assert.ok(logged[0].includes(SUITE));
  const state = readStateFile(root);
  assert.equal(state.id, FID);
  assert.equal(state.stage, 'started');
  assert.equal(state.head, g(root, 'rev-parse', 'HEAD').trim());
});

test('start: 전제 조건이 맞지 않으면 거부하고 상태 파일을 만들지 않는다', () => {
  const noState = (root) => assert.equal(fs.existsSync(path.join(root, '.review', 'fix.tmp')), false);

  const dirty = makeRepo();
  write(dirty, 'src/a.js', 'function foo() { edited }\n');
  assert.throws(() => start(dirty, FID), /커밋하지 않은 변경/);
  noState(dirty);

  const resolved = makeRepo({ status: 'resolved' });
  assert.throws(() => start(resolved, FID), /open/);
  noState(resolved);

  const unknown = makeRepo();
  assert.throws(() => start(unknown, 'F-missing'), /원장에 없는/);
  noState(unknown);

  const noConfig = makeRepo();
  fs.rmSync(path.join(noConfig, '.review', 'config.json'));
  g(noConfig, 'commit', '-q', '-am', 'drop config');
  assert.throws(() => start(noConfig, FID), /review-config/);
  noState(noConfig);

  const busy = makeRepo();
  start(busy, FID);
  assert.throws(() => start(busy, FID), /진행 중인 수정/);

  const notRepo = tmpDir();
  init(notRepo, PLUGIN_ROOT);
  saveConfig(notRepo, { version: 1, checks: [], testPaths: ['test/**'] });
  saveLedger(notRepo, loadLedger(makeRepo()));
  assert.throws(() => start(notRepo, FID), LedgerError);
});

test('start: 미추적 파일, 커밋 안 한 .review, 검사가 만든 파일은 막지 않고 원래 있던 것으로 기록한다', () => {
  const artifact = helper(
    'artifact.js',
    "const fs=require('fs');fs.mkdirSync('coverage',{recursive:true});fs.writeFileSync('coverage/out.txt','x');",
  );
  const root = makeRepo({ checks: [{ name: 'test', kind: 'test', command: artifact }] });
  write(root, 'notes.txt', '메모');
  write(root, '.review/rules.md', '## R-900 고친 규칙\n');
  start(root, FID);
  assert.deepEqual(Object.keys(readStateFile(root).known).sort(), ['coverage/out.txt', 'notes.txt']);
});

test('abort: 수정이 만든 변경만 되돌린다', () => {
  const root = makeRepo();
  write(root, 'notes.txt', '메모');
  write(root, '.review/rules.md', '## R-900 고친 규칙\n');
  const before = statusOutsideReview(root);
  start(root, FID);

  write(root, 'src/a.js', 'function foo() { BROKEN }\n');
  write(root, 'test/새 파일.test.js', 'REPRO\n');
  write(root, 'src/b.js', 'staged\n');
  g(root, 'add', 'src/b.js');

  assert.deepEqual(abort(root), { aborted: true, id: FID, fixAttempts: 1, unrestored: [] });
  assert.deepEqual(statusOutsideReview(root), before);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'a.js'), 'utf8'), 'function foo() {}\n');
  assert.equal(fs.existsSync(path.join(root, 'test', '새 파일.test.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'src', 'b.js')), false);
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), '메모');
  assert.equal(
    fs.readFileSync(path.join(root, '.review', 'rules.md'), 'utf8'),
    '## R-900 고친 규칙\n',
  );
  assert.equal(loadLedger(root).findings[0].fixAttempts, 1);
  assert.equal(loadLedger(root).findings[0].status, 'open');
  assert.equal(fs.existsSync(path.join(root, '.review', 'fix.tmp')), false);
});

test('abort: 진행 중인 수정이 없으면 아무것도 하지 않는다', () => {
  const root = makeRepo();
  write(root, 'src/a.js', 'function foo() { 사용자가 고치는 중 }\n');
  assert.deepEqual(abort(root), { aborted: false });
  assert.equal(
    fs.readFileSync(path.join(root, 'src', 'a.js'), 'utf8'),
    'function foo() { 사용자가 고치는 중 }\n',
  );
});

// test/a.test.js 에 LINTERR 가 있으면 실패하는 정적 검사.
const LINT = helper(
  'lint.js',
  "const fs=require('fs');const f='test/a.test.js';process.exit(fs.existsSync(f)&&fs.readFileSync(f,'utf8').includes('LINTERR')?1:0);",
);

const fixSource = (root) => write(root, 'src/a.js', 'function foo() { FIXED }\n');
const verdictOf = (result, name) => result.verdicts.find((v) => v.name === name).verdict;

test('stageRed: 재현 테스트가 실패하면 통과하고 테스트 해시를 기록한다', () => {
  const root = makeRepo();
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  const result = stageRed(root, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(verdictOf(result, 'test'), 'regressed');
  const state = readStateFile(root);
  assert.equal(state.stage, 'red');
  assert.equal(state.repro, true);
  assert.deepEqual(Object.keys(state.testHashes), ['test/a.test.js']);
});

test('stageRed: 재현한다던 테스트가 실패하지 않거나 정적 검사를 깨면 통과하지 못한다', () => {
  const root = makeRepo({
    checks: [
      { name: 'test', kind: 'test', command: SUITE },
      { name: 'lint', kind: 'static', command: LINT },
    ],
  });
  start(root, FID);
  write(root, 'test/a.test.js', '재현하지 못하는 테스트\n');
  const notFailing = stageRed(root, true);
  assert.equal(notFailing.ok, false);
  assert.deepEqual(notFailing.reasons, ['repro-not-failing']);
  assert.equal(readStateFile(root).stage, 'started');

  write(root, 'test/a.test.js', 'REPRO LINTERR\n');
  assert.deepEqual(stageRed(root, true).reasons, ['static-regression']);
});

test('stageRed: 재현 테스트가 없다고 했는데 테스트가 깨지면 통과하지 못한다', () => {
  const root = makeRepo();
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  const result = stageRed(root, false);
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['unexpected-regression']);
});

test('stageRed: 테스트 단계에서 제품 코드를 건드리면 통과하지 못한다', () => {
  const root = makeRepo();
  start(root, FID);
  fixSource(root);
  assert.deepEqual(stageRed(root, false).reasons, ['non-test-file-changed']);
});

test('stage: 단계를 건너뛰면 LedgerError', () => {
  const root = makeRepo();
  assert.throws(() => stageRed(root, false), /건너뛸 수 없습니다/);
  assert.throws(() => stageFixed(root, 'absent'), /건너뛸 수 없습니다/);
  start(root, FID);
  assert.throws(() => stageFixed(root, 'absent'), /건너뛸 수 없습니다/);
});

test('stageFixed: 재현 테스트가 빨강에서 초록이 되면 reproduced', () => {
  const root = makeRepo();
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  stageRed(root, true);
  fixSource(root);
  const result = stageFixed(root, 'absent');
  assert.deepEqual(
    { ok: result.ok, reasons: result.reasons, level: result.level, outOfScope: result.outOfScope },
    { ok: true, reasons: [], level: 'reproduced', outOfScope: [] },
  );
  assert.equal(readStateFile(root).stage, 'fixed');
});

test('stageFixed: 재현 테스트 없이 검사가 통과하면 guarded', () => {
  const root = makeRepo();
  start(root, FID);
  stageRed(root, false);
  fixSource(root);
  const result = stageFixed(root, 'absent');
  assert.equal(result.ok, true);
  assert.equal(result.level, 'guarded');
});

test('stageFixed: 가려지지 않은 검사가 없으면 unverified', () => {
  for (const checks of [[{ name: 'test', kind: 'test', command: FAIL }], []]) {
    const root = makeRepo({ checks });
    start(root, FID);
    assert.equal(stageRed(root, false).ok, true);
    fixSource(root);
    const result = stageFixed(root, 'absent');
    assert.equal(result.ok, true);
    assert.equal(result.level, 'unverified');
  }
});

test('stageFixed: 회귀가 있으면 통과하지 못하고 출력 끝부분을 돌려준다', () => {
  const root = makeRepo();
  start(root, FID);
  stageRed(root, false);
  write(root, 'src/a.js', 'function foo() { BROKEN }\n');
  const result = stageFixed(root, 'absent');
  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['regression']);
  assert.match(result.verdicts[0].tail, /suite ran/);
  assert.equal(readStateFile(root).stage, 'red');

  fixSource(root);
  assert.equal(stageFixed(root, 'absent').ok, true);
});

test('stageFixed: 지적이 남아 있으면 통과하지 못한다', () => {
  const root = makeRepo();
  start(root, FID);
  stageRed(root, false);
  fixSource(root);
  assert.deepEqual(stageFixed(root, 'present').reasons, ['finding-present']);
});

test('stageFixed: 대상 파일과 테스트 밖의 변경을 범위 밖으로 알린다', () => {
  const root = makeRepo();
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  stageRed(root, true);
  fixSource(root);
  write(root, 'src/b.js', '호출부\n');
  write(root, 'docs/새 문서.md', '문서\n');
  const result = stageFixed(root, 'absent');
  assert.equal(result.ok, true);
  assert.deepEqual(result.outOfScope.sort(), ['docs/새 문서.md', 'src/b.js']);
});

test('stageFixed: 수정 단계에서 테스트를 고치면 통과하지 못한다', () => {
  const root = makeRepo();
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  stageRed(root, true);
  fixSource(root);
  write(root, 'test/a.test.js', '통과하도록 고친 테스트\n');
  assert.deepEqual(stageFixed(root, 'absent').reasons, ['tests-changed']);
});

test('회귀로 나온 검사가 다시 실행해서 통과하면 flaky 이고 회귀로 세지 않는다', () => {
  // 실행할 때마다 횟수를 세고, 두 번째 실행에서만 실패한다.
  const counter = path.join(tmpDir(), 'count');
  const flaky = `${helper(
    'flaky.js',
    "const fs=require('fs');const f=process.argv[2];const n=fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0;fs.writeFileSync(f,String(n+1));process.exit(n===1?1:0);",
  )} "${counter}"`;
  const root = makeRepo({ checks: [{ name: 'test', kind: 'test', command: flaky }] });
  start(root, FID);
  const result = stageRed(root, false);
  assert.equal(verdictOf(result, 'test'), 'flaky');
  assert.equal(result.ok, true);
});

function toFixed(root, { repro = true } = {}) {
  start(root, FID);
  if (repro) write(root, 'test/a.test.js', 'REPRO\n');
  stageRed(root, repro);
  fixSource(root);
  return stageFixed(root, 'absent');
}

test('finish: 원장을 고치고 지적 ID 를 담아 한 커밋으로 만든다', () => {
  const root = makeRepo({ title: '이름에 "따옴표"와 $변수,\n줄바꿈이 있는 제목' });
  toFixed(root);
  const result = finish(root);
  assert.equal(result.id, FID);
  assert.equal(result.level, 'reproduced');
  assert.equal(result.commit, g(root, 'rev-parse', '--short', 'HEAD').trim());

  assert.equal(
    g(root, 'log', '-1', '--format=%B').trim(),
    `fix(review): 이름에 "따옴표"와 $변수, 줄바꿈이 있는 제목 [${FID}]`,
  );
  assert.deepEqual(
    g(root, '-c', 'core.quotepath=false', 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(),
    ['.review/findings.json', 'src/a.js', 'test/a.test.js'],
  );
  const finding = loadLedger(root).findings[0];
  assert.equal(finding.status, 'resolved');
  assert.equal(finding.fixLevel, 'reproduced');
  assert.equal(g(root, 'status', '--porcelain'), '');
  assert.equal(fs.existsSync(path.join(root, '.review', 'fix.tmp')), false);
});

test('finish: 통과한 stage fixed 가 없으면 LedgerError', () => {
  const root = makeRepo();
  assert.throws(() => finish(root), /건너뛸 수 없습니다/);
  start(root, FID);
  assert.throws(() => finish(root), /건너뛸 수 없습니다/);
  stageRed(root, false);
  write(root, 'src/a.js', 'function foo() { BROKEN }\n');
  stageFixed(root, 'absent');
  assert.throws(() => finish(root), /건너뛸 수 없습니다/);
  assert.equal(loadLedger(root).findings[0].status, 'open');
});

test('finish: unverified 는 승인 플래그가 있어야 커밋된다', () => {
  const root = makeRepo({ checks: [] });
  assert.equal(toFixed(root, { repro: false }).level, 'unverified');
  assert.throws(() => finish(root), /allow-unverified/);
  assert.equal(loadLedger(root).findings[0].status, 'open');
  assert.equal(finish(root, { allowUnverified: true }).level, 'unverified');
  assert.equal(loadLedger(root).findings[0].fixLevel, 'unverified');
});

test('finish: 범위 밖 파일은 승인 플래그가 있어야 커밋된다', () => {
  const root = makeRepo();
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  stageRed(root, true);
  fixSource(root);
  write(root, 'src/b.js', '호출부\n');
  stageFixed(root, 'absent');
  assert.throws(() => finish(root), /allow-out-of-scope/);
  finish(root, { allowOutOfScope: true });
  assert.ok(g(root, 'show', '--name-only', '--format=', 'HEAD').includes('src/b.js'));
});

test('finish: 커밋이 실패하면 원장을 되돌리고 작업 트리와 상태는 남긴다', () => {
  const root = makeRepo();
  toFixed(root);
  const hook = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  const head = g(root, 'rev-parse', 'HEAD');

  assert.throws(() => finish(root), LedgerError);
  assert.equal(g(root, 'rev-parse', 'HEAD'), head);
  assert.equal(loadLedger(root).findings[0].status, 'open');
  assert.equal('fixLevel' in loadLedger(root).findings[0], false);
  assert.equal(g(root, 'diff', '--cached', '--name-only'), '');
  assert.equal(fs.readFileSync(path.join(root, 'src', 'a.js'), 'utf8'), 'function foo() { FIXED }\n');
  assert.equal(readStateFile(root).stage, 'fixed');

  fs.rmSync(hook);
  assert.equal(finish(root).level, 'reproduced');
});

const FIX_SCRIPT = fileURLToPath(new URL('./fix.mjs', import.meta.url));

function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [FIX_SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('CLI: start 부터 finish 까지 이어서 동작한다', () => {
  const root = makeRepo();
  assert.equal(JSON.parse(cli(root, 'config', 'show').stdout).version, 1);

  const started = cli(root, 'start', FID);
  assert.equal(started.code, 0);
  assert.match(started.stderr, /검사 실행: test/);
  assert.deepEqual(JSON.parse(started.stdout).masked, []);

  write(root, 'test/a.test.js', 'REPRO\n');
  assert.equal(JSON.parse(cli(root, 'stage', 'red', '--repro', 'yes').stdout).ok, true);
  fixSource(root);
  const fixed = JSON.parse(cli(root, 'stage', 'fixed', '--recheck', 'absent').stdout);
  assert.equal(fixed.level, 'reproduced');
  const done = cli(root, 'finish');
  assert.equal(done.code, 0);
  assert.equal(JSON.parse(done.stdout).id, FID);
  assert.equal(loadLedger(root).findings[0].status, 'resolved');
});

test('CLI: 판정 실패는 종료 코드 0, 잘못된 호출은 1', () => {
  const root = makeRepo();
  cli(root, 'start', FID);
  cli(root, 'stage', 'red', '--repro', 'no');
  const notOk = cli(root, 'stage', 'fixed', '--recheck', 'present');
  assert.equal(notOk.code, 0);
  assert.equal(JSON.parse(notOk.stdout).ok, false);

  assert.equal(cli(root, 'stage', 'red').code, 1);
  assert.equal(cli(root, 'stage', 'fixed', '--recheck', 'maybe').code, 1);
  assert.equal(cli(root, 'finish').code, 1);
  assert.equal(cli(root, 'unknown').code, 1);
  assert.equal(cli(root, 'start').code, 1);

  const bad = path.join(tmpDir(), 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ version: 9 }));
  const rejected = cli(root, 'config', 'set', bad);
  assert.equal(rejected.code, 1);
  assert.notEqual(rejected.stderr, '');

  const aborted = cli(root, 'abort');
  assert.equal(aborted.code, 0);
  assert.equal(JSON.parse(aborted.stdout).aborted, true);
});

test('문서: fixer 와 두 스킬의 frontmatter, 필요한 명령과 지침이 있다', () => {
  const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

  const fixer = read('agents/fixer.md');
  assert.match(fixer, /^---\nname: fixer\ndescription: \S/);
  assert.match(fixer, /^tools: Read, Grep, Glob, Edit, Write$/m);

  const config = read('skills/review-config/SKILL.md');
  assert.match(config, /^---\nname: review-config\ndescription: \S/);
  assert.match(config, /^disable-model-invocation: true$/m);
  assert.match(config, /fix\.mjs" config set/);

  const fix = read('skills/review-fix/SKILL.md');
  assert.match(fix, /^---\nname: review-fix\ndescription: \S/);
  assert.match(fix, /^disable-model-invocation: true$/m);
  for (const cmd of ['start', 'stage red', 'stage fixed', 'finish', 'abort']) {
    assert.ok(fix.includes(`fix.mjs" ${cmd}`), `review-fix: ${cmd} 명령이 없습니다`);
  }
  for (const agent of ['anetos-review:fixer', 'anetos-review:verifier']) {
    assert.ok(fix.includes(agent), `review-fix: ${agent} 호출이 없습니다`);
  }

  assert.match(read('skills/review/SKILL.md'), /고쳐진 지적/);
  for (const agent of ['rule-checker', 'explorer']) {
    assert.match(read(`agents/${agent}.md`), /고쳐진 지적의 수정을 되돌리자는 지적은 내지 않는다/);
  }
});

const committedFiles = (root) =>
  g(root, '-c', 'core.quotepath=false', 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort();

test('start: 지적의 파일이 git 에 추적되지 않으면 거부한다', () => {
  const root = makeRepo();
  g(root, 'rm', '-q', '--cached', 'src/a.js');
  g(root, 'commit', '-q', '-m', 'untrack');
  assert.throws(() => start(root, FID), /추적되지 않/);
  assert.equal(fs.existsSync(path.join(root, '.review', 'fix.tmp')), false);
});

test('start: 저장소 최상위가 아닌 곳에서는 거부한다', () => {
  const root = makeRepo();
  const sub = path.join(root, 'pkg');
  fs.mkdirSync(sub);
  init(sub, PLUGIN_ROOT);
  saveLedger(sub, loadLedger(root));
  saveConfig(sub, loadConfig(root));
  assert.throws(() => start(sub, FID), /최상위/);
});

test('원래 있던 미추적 파일을 수정이 바꾸면 범위 밖으로 잡히고 abort 가 되돌리지 못했다고 알린다', () => {
  const root = makeRepo();
  write(root, 'notes.txt', '메모');
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  stageRed(root, true);
  fixSource(root);
  write(root, 'notes.txt', '수정이 덮어쓴 메모');
  assert.deepEqual(stageFixed(root, 'absent').outOfScope, ['notes.txt']);
  assert.deepEqual(abort(root).unrestored, ['notes.txt']);
});

test('finish: stage fixed 이후 파일이 바뀌면 커밋하지 않는다', () => {
  const edited = makeRepo();
  toFixed(edited);
  write(edited, 'src/a.js', 'function foo() { FIXED 그리고 확인 안 된 변경 }\n');
  assert.throws(() => finish(edited), /stage fixed 를 다시/);
  assert.equal(loadLedger(edited).findings[0].status, 'open');

  const added = makeRepo();
  toFixed(added);
  write(added, 'src/other.js', '확인 안 된 새 파일\n');
  assert.throws(() => finish(added), /stage fixed 를 다시/);
});

test('수정 도중 config.json 을 바꿔도 시작할 때의 검사로 판정하고, 커밋에는 원장만 들어간다', () => {
  const root = makeRepo();
  write(root, '.review/rules.md', '## R-900 커밋 안 한 규칙\n');
  start(root, FID);
  stageRed(root, false);
  write(root, 'src/a.js', 'function foo() { BROKEN }\n');
  saveConfig(root, {
    version: 1,
    checks: [{ name: 'other', kind: 'test', command: PASS }],
    testPaths: ['**'],
  });
  assert.deepEqual(stageFixed(root, 'absent').reasons, ['regression']);

  fixSource(root);
  assert.equal(stageFixed(root, 'absent').ok, true);
  finish(root);
  assert.deepEqual(committedFiles(root), ['.review/findings.json', 'src/a.js']);
  assert.match(g(root, 'status', '--porcelain'), /\.review\/rules\.md/);
});

test('수정 단계에서 기존 테스트 파일을 고치면 범위 밖으로 알린다', () => {
  const root = makeRepo();
  write(root, 'test/old.test.js', '기존 테스트\n');
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', 'old test');
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  stageRed(root, true);
  fixSource(root);
  write(root, 'test/old.test.js', '통과하도록 약하게 고친 기존 테스트\n');
  const result = stageFixed(root, 'absent');
  assert.deepEqual(result.outOfScope, ['test/old.test.js']);
  assert.throws(() => finish(root), /allow-out-of-scope/);
});

test('검사가 실행마다 새 파일을 만들고 추적 파일을 고쳐도 수정의 변경으로 보지 않는다', () => {
  const noisy = helper(
    'noisy.js',
    [
      "const fs=require('fs');",
      "fs.mkdirSync('coverage',{recursive:true});",
      "fs.writeFileSync('coverage/run-'+Date.now()+'-'+Math.random()+'.json','{}');",
      "fs.appendFileSync('report.txt','run\\n');",
    ].join('\n'),
  );
  const root = makeRepo({
    checks: [
      { name: 'test', kind: 'test', command: SUITE },
      { name: 'noisy', kind: 'static', command: noisy },
    ],
  });
  write(root, 'report.txt', '');
  g(root, 'add', '-A');
  g(root, 'commit', '-q', '-m', 'report');

  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  assert.deepEqual(stageRed(root, true).reasons, []);
  fixSource(root);
  const result = stageFixed(root, 'absent');
  assert.equal(result.ok, true);
  assert.deepEqual(result.outOfScope, []);
  finish(root);
  assert.deepEqual(committedFiles(root), ['.review/findings.json', 'src/a.js', 'test/a.test.js']);
  assert.ok(fs.readdirSync(path.join(root, 'coverage')).length >= 3);
});

test('finish: 대괄호가 든 파일 이름이 다른 파일을 끌고 들어가지 않는다', () => {
  const root = makeRepo();
  write(root, 'src/b.js', '사용자의 미추적 파일\n');
  start(root, FID);
  write(root, 'test/a.test.js', 'REPRO\n');
  stageRed(root, true);
  fixSource(root);
  write(root, 'src/[ab].js', '수정이 만든 파일\n');
  stageFixed(root, 'absent');
  finish(root, { allowOutOfScope: true });
  assert.deepEqual(committedFiles(root), [
    '.review/findings.json', 'src/[ab].js', 'src/a.js', 'test/a.test.js',
  ]);
  assert.match(g(root, 'status', '--porcelain'), /\?\? src\/b\.js/);
});

test('stageFixed: 아무것도 고치지 않았으면 통과하지 못한다', () => {
  const root = makeRepo();
  start(root, FID);
  stageRed(root, false);
  assert.deepEqual(stageFixed(root, 'absent').reasons, ['nothing-fixed']);
});

test('runCheck: 제한 시간을 넘긴 검사의 프로세스가 남지 않는다', () => {
  const marker = path.join(tmpDir(), 'late');
  const cmd = `${helper(
    'late.js',
    "setTimeout(()=>require('fs').writeFileSync(process.argv[2],'x'),2500);",
  )} "${marker}"`;
  const r = runCheck(tmpDir(), { name: 'a', kind: 'test', command: cmd, timeoutSec: 0.5 });
  assert.equal(r.timedOut, true);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3500);
  assert.equal(fs.existsSync(marker), false);
});
