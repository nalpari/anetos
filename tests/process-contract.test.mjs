// anetos-process 는 ledger.mjs 와 fix.mjs 의 출력을 읽어 진행 상황을 표시한다.
// 이 테스트는 두 스크립트를 실제로 실행해서 얻은 출력을 anetos-process 의 해석기에 그대로 넣는다.
// 스크립트의 출력 형식이 바뀌어 mod 의 해석이 어긋나면 여기서 실패해야 한다.
//
// 실행: node --experimental-strip-types --test tests/process-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommands, parseJson, reduce } from '../anetos-process/hooks/flow.ts';

const SCRIPTS = fileURLToPath(new URL('../anetos-review/scripts', import.meta.url));

function git(root, ...args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

function write(root, rel, text) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// 스킬이 쓰는 형태의 명령을 만들고, 실제로 실행한 뒤, mod 가 보는 사건으로 바꾼다.
function run(root, script, args, at) {
  const command = `node "${SCRIPTS.replace(/\\/g, '/')}/${script}.mjs" ${args.join(' ')}`;
  const calls = parseCommands(command);
  assert.equal(calls.length, 1, `명령을 읽지 못했다: ${command}`);
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, `${script}.mjs`), ...args], { cwd: root, encoding: 'utf8' });
  const ok = r.status === 0;
  return { type: 'script', call: calls[0], ok, data: ok ? parseJson(r.stdout) : undefined, at };
}

const stage = (flow, key) => flow.stages.find((s) => s.key === key);

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.autocrlf', 'false');
  write(root, 'src/a.js', 'function foo() {}\nfunction bar() {}\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

test('실제 스크립트의 출력으로 리뷰 흐름과 수정 흐름이 끝까지 간다', () => {
  const root = makeRepo();

  // 리뷰: init → apply
  let flow = reduce(null, run(root, 'ledger', ['init'], 1));
  assert.equal(flow.kind, 'review');
  assert.equal(stage(flow, 'load').status, 'running');

  const violation = (symbol) => ({
    source: 'R-003', file: 'src/a.js', symbol, title: `${symbol} 의 문제`, evidence: 'src/a.js:1', matches: null,
  });
  write(root, '.review/results.tmp', JSON.stringify({
    commit: 'c1', rechecks: [], violations: [violation('foo'), violation('bar')], candidates: [],
  }));
  flow = reduce(flow, run(root, 'ledger', ['apply', '.review/results.tmp'], 2));
  fs.rmSync(path.join(root, '.review', 'results.tmp'));
  assert.equal(flow.outcome, 'done');
  assert.equal(flow.summary, '신규 2');

  // 형식이 틀린 결과는 실패로 읽혀야 한다.
  write(root, '.review/bad.tmp', '{ "commit": "" }');
  const failed = reduce(reduce(null, run(root, 'ledger', ['init'], 3)), run(root, 'ledger', ['apply', '.review/bad.tmp'], 4));
  fs.rmSync(path.join(root, '.review', 'bad.tmp'));
  assert.equal(failed.outcome, 'running');
  assert.equal(stage(failed, 'apply').status, 'failed');

  // 수정 준비: 검증 설정과 커밋
  write(root, '.review/config.tmp', JSON.stringify({
    version: 1,
    checks: [
      { name: 'test', kind: 'test', command: 'node -e "process.exit(0)"' },
      { name: 'lint', kind: 'static', command: 'node -e "process.exit(1)"' },
    ],
    testPaths: ['test/**'],
  }));
  assert.equal(run(root, 'fix', ['config', 'set', '.review/config.tmp'], 5).ok, true);
  fs.rmSync(path.join(root, '.review', 'config.tmp'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'review');

  const open = run(root, 'ledger', ['list', '--status', 'open'], 6);
  const [first, second] = open.data;
  assert.ok(first.id && second.id);

  // 수정 1: start → stage red → stage fixed → finish
  flow = reduce(flow, run(root, 'fix', ['start', first.id], 10));
  assert.equal(flow.kind, 'fix');
  assert.equal(flow.title, `수정 ${first.id}`);
  assert.equal(stage(flow, 'baseline').note, '가려진 검사: lint');
  flow = reduce(flow, open);
  assert.equal(flow.detail, first.title);

  flow = reduce(flow, run(root, 'fix', ['stage', 'red', '--repro', 'no'], 11));
  assert.equal(stage(flow, 'red').status, 'done');

  // 지적이 남아 있다고 하면 통과하지 못하고 이유가 적힌다.
  write(root, 'src/a.js', 'function foo() { fixed }\nfunction bar() {}\n');
  flow = reduce(flow, run(root, 'fix', ['stage', 'fixed', '--recheck', 'present'], 12));
  assert.equal(stage(flow, 'green').status, 'retry');
  assert.equal(stage(flow, 'green').note, 'finding-present');

  flow = reduce(flow, run(root, 'fix', ['stage', 'fixed', '--recheck', 'absent'], 13));
  assert.equal(stage(flow, 'green').status, 'done');
  assert.equal(stage(flow, 'green').note, 'guarded');

  flow = reduce(flow, run(root, 'fix', ['finish'], 14));
  assert.equal(flow.outcome, 'committed');
  assert.match(flow.summary, /^커밋 [0-9a-f]{7,} · guarded$/);

  // 전제 조건 위반은 흐름을 만들지 않는다.
  assert.equal(reduce(null, run(root, 'fix', ['start', 'F-missing'], 20)), null);

  // 수정 2: start → abort
  flow = reduce(flow, run(root, 'fix', ['start', second.id], 21));
  assert.equal(flow.title, `수정 ${second.id}`);
  write(root, 'src/a.js', 'function foo() { fixed }\nfunction bar() { 반쯤 고침 }\n');
  flow = reduce(flow, run(root, 'fix', ['abort'], 22));
  assert.equal(flow.outcome, 'aborted');
  assert.equal(flow.summary, '중단됨');
  assert.equal(stage(flow, 'commit').status, 'skipped');
});
