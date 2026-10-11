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
