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
  assert.deepEqual(readStateFile(root).untracked.sort(), ['coverage/out.txt', 'notes.txt']);
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

  assert.deepEqual(abort(root), { aborted: true, id: FID, fixAttempts: 1 });
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
