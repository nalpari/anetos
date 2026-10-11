import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findingId, init, loadLedger, saveLedger, list, LedgerError } from './ledger.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
}

function fakePlugin() {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'rules'));
  fs.writeFileSync(path.join(dir, 'rules', 'default.md'), '## R-001 테스트 규칙\n');
  return dir;
}

test('findingId: 같은 입력이면 같은 ID', () => {
  const a = findingId('R-001', 'src/db/user.ts', 'findUserByName');
  const b = findingId('R-001', 'src/db/user.ts', 'findUserByName');
  assert.equal(a, b);
  assert.match(a, /^F-[0-9a-f]{8}$/);
});

test('findingId: source, file, symbol 중 하나라도 다르면 다른 ID', () => {
  const base = findingId('R-001', 'src/a.ts', 'foo');
  assert.notEqual(base, findingId('R-002', 'src/a.ts', 'foo'));
  assert.notEqual(base, findingId('R-001', 'src/b.ts', 'foo'));
  assert.notEqual(base, findingId('R-001', 'src/a.ts', 'bar'));
});

test('findingId: 역슬래시 경로와 ./ 접두사는 같은 ID', () => {
  const expected = findingId('R-001', 'src/db/user.ts', 'foo');
  assert.equal(findingId('R-001', 'src\\db\\user.ts', 'foo'), expected);
  assert.equal(findingId('R-001', './src/db/user.ts', 'foo'), expected);
});

test('init: .review 를 만들고 기본 규칙을 복사한다', () => {
  const root = tmpDir();
  const result = init(root, fakePlugin());
  assert.deepEqual(result, { created: true });
  const dir = path.join(root, '.review');
  assert.equal(fs.readFileSync(path.join(dir, 'rules.md'), 'utf8'), '## R-001 테스트 규칙\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'findings.json'), 'utf8')), {
    version: 1,
    findings: [],
  });
  assert.equal(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'), '# 결정 기록\n');
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '*.tmp\n');
});

test('init: 이미 있으면 아무것도 바꾸지 않는다', () => {
  const root = tmpDir();
  const plugin = fakePlugin();
  init(root, plugin);
  const rules = path.join(root, '.review', 'rules.md');
  fs.writeFileSync(rules, '## R-900 프로젝트 규칙\n');
  assert.deepEqual(init(root, plugin), { created: false });
  assert.equal(fs.readFileSync(rules, 'utf8'), '## R-900 프로젝트 규칙\n');
});

function finding(over = {}) {
  return {
    id: 'F-00000001',
    source: 'R-001',
    file: 'src/a.js',
    symbol: 'foo',
    title: '제목',
    evidence: 'src/a.js:1',
    status: 'open',
    firstSeen: 'c0',
    lastChecked: 'c0',
    decisionId: null,
    ...over,
  };
}

function initRoot() {
  const root = tmpDir();
  init(root, fakePlugin());
  return root;
}

test('saveLedger 후 loadLedger 는 같은 내용을 돌려준다', () => {
  const root = initRoot();
  const ledger = { version: 1, findings: [finding()] };
  saveLedger(root, ledger);
  assert.deepEqual(loadLedger(root), ledger);
  assert.equal(fs.existsSync(path.join(root, '.review', 'findings.json.tmp')), false);
});

test('loadLedger: 원장이 없으면 LedgerError', () => {
  assert.throws(() => loadLedger(tmpDir()), LedgerError);
});

test('loadLedger: 깨진 JSON 이면 LedgerError', () => {
  const root = initRoot();
  fs.writeFileSync(path.join(root, '.review', 'findings.json'), '{ "version": 1, ');
  assert.throws(() => loadLedger(root), LedgerError);
});

test('loadLedger: version 이 다르면 LedgerError', () => {
  const root = initRoot();
  fs.writeFileSync(
    path.join(root, '.review', 'findings.json'),
    JSON.stringify({ version: 2, findings: [] }),
  );
  assert.throws(() => loadLedger(root), LedgerError);
});

test('list: 파일과 상태로 거른다', () => {
  const ledger = {
    version: 1,
    findings: [
      finding({ id: 'F-1', file: 'src/a.js', status: 'open' }),
      finding({ id: 'F-2', file: 'src/a.js', status: 'resolved' }),
      finding({ id: 'F-3', file: 'src/b.js', status: 'open' }),
    ],
  };
  assert.deepEqual(list(ledger).map((f) => f.id), ['F-1', 'F-2', 'F-3']);
  assert.deepEqual(list(ledger, { files: ['src/a.js'] }).map((f) => f.id), ['F-1', 'F-2']);
  assert.deepEqual(list(ledger, { status: 'open' }).map((f) => f.id), ['F-1', 'F-3']);
  assert.deepEqual(
    list(ledger, { files: ['src\\a.js'], status: 'open' }).map((f) => f.id),
    ['F-1'],
  );
});
