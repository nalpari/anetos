import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findingId, init } from './ledger.mjs';

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
