import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findingId, init, loadLedger, saveLedger, list, apply, LedgerError } from './ledger.mjs';

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

function emptyLedger() {
  return { version: 1, findings: [] };
}

function results(over = {}) {
  return { commit: 'c1', rechecks: [], violations: [], candidates: [], ...over };
}

function viol(over = {}) {
  return {
    source: 'R-001',
    file: 'src/a.js',
    symbol: 'foo',
    title: '위반',
    evidence: 'src/a.js:1',
    matches: null,
    ...over,
  };
}

function cand(over = {}) {
  return {
    category: 'bug',
    file: 'src/a.js',
    symbol: 'bar',
    title: '후보',
    evidence: 'src/a.js:9',
    matches: null,
    verdict: 'confirmed',
    ...over,
  };
}

const VIOL_ID = findingId('R-001', 'src/a.js', 'foo');
const CAND_ID = findingId('explore:bug', 'src/a.js', 'bar');

test('apply: 새 위반은 open 으로 등록된다', () => {
  const ledger = emptyLedger();
  const summary = apply(ledger, results({ violations: [viol()] }));
  assert.deepEqual(summary.new, [VIOL_ID]);
  assert.deepEqual(ledger.findings, [
    {
      id: VIOL_ID,
      source: 'R-001',
      file: 'src/a.js',
      symbol: 'foo',
      title: '위반',
      evidence: 'src/a.js:1',
      status: 'open',
      firstSeen: 'c1',
      lastChecked: 'c1',
      decisionId: null,
    },
  ]);
});

test('apply: 같은 결과를 두 번 적용해도 원장이 같다', () => {
  const ledger = emptyLedger();
  const input = results({ violations: [viol()], candidates: [cand()] });
  apply(ledger, input);
  const first = JSON.stringify(ledger);
  const summary = apply(ledger, input);
  assert.equal(JSON.stringify(ledger), first);
  assert.deepEqual(summary.new, []);
  assert.deepEqual(summary.stillOpen.sort(), [VIOL_ID, CAND_ID].sort());
});

test('apply: 줄 번호만 달라진 위반은 같은 지적이다', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  apply(ledger, results({ commit: 'c2', violations: [viol({ evidence: 'src/a.js:57' })] }));
  assert.equal(ledger.findings.length, 1);
  assert.equal(ledger.findings[0].evidence, 'src/a.js:57');
  assert.equal(ledger.findings[0].firstSeen, 'c1');
  assert.equal(ledger.findings[0].lastChecked, 'c2');
});

test('apply: 재확인 absent 는 resolved, 다시 나오면 recurred', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  const s1 = apply(ledger, results({ commit: 'c2', rechecks: [{ id: VIOL_ID, verdict: 'absent', evidence: '' }] }));
  assert.deepEqual(s1.resolved, [VIOL_ID]);
  assert.equal(ledger.findings[0].status, 'resolved');
  const s2 = apply(ledger, results({ commit: 'c3', violations: [viol()] }));
  assert.deepEqual(s2.recurred, [VIOL_ID]);
  assert.deepEqual(s2.new, []);
  assert.equal(ledger.findings[0].status, 'open');
});

test('apply: 확인 안 된 후보는 dismissed 로 남고 다시 올라와도 신규가 아니다', () => {
  const ledger = emptyLedger();
  const s1 = apply(ledger, results({ candidates: [cand({ verdict: 'unconfirmed' })] }));
  assert.deepEqual(s1.dismissed, [CAND_ID]);
  assert.equal(ledger.findings[0].status, 'dismissed');
  const s2 = apply(ledger, results({ commit: 'c2', candidates: [cand({ verdict: 'confirmed' })] }));
  assert.deepEqual(s2.new, []);
  assert.deepEqual(s2.stillOpen, []);
  assert.equal(ledger.findings[0].status, 'dismissed');
});

test('apply: intended 지적이 다시 나오면 reopen-requested', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  ledger.findings[0].status = 'intended';
  const summary = apply(ledger, results({ commit: 'c2', violations: [viol()] }));
  assert.deepEqual(summary.reopenRequested, [VIOL_ID]);
  assert.deepEqual(summary.new, []);
  assert.equal(ledger.findings[0].status, 'reopen-requested');
  assert.equal(ledger.findings[0].previousStatus, 'intended');
});

test('apply: reopen-requested 상태에서 다시 나와도 previousStatus 가 유지된다', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  ledger.findings[0].status = 'rejected';
  apply(ledger, results({ commit: 'c2', violations: [viol()] }));
  apply(ledger, results({ commit: 'c3', violations: [viol()] }));
  assert.equal(ledger.findings[0].status, 'reopen-requested');
  assert.equal(ledger.findings[0].previousStatus, 'rejected');
});

test('apply: matches 가 있으면 심볼이 달라도 기존 지적을 쓴다', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  const summary = apply(
    ledger,
    results({ commit: 'c2', violations: [viol({ symbol: 'UserRepo.foo', matches: VIOL_ID })] }),
  );
  assert.equal(ledger.findings.length, 1);
  assert.deepEqual(summary.stillOpen, [VIOL_ID]);
});

test('apply: 한 번에 같은 위반이 두 번 들어와도 지적은 하나다', () => {
  const ledger = emptyLedger();
  const summary = apply(ledger, results({ violations: [viol(), viol({ file: 'src\\a.js' })] }));
  assert.equal(ledger.findings.length, 1);
  assert.deepEqual(summary.new, [VIOL_ID]);
  assert.deepEqual(summary.stillOpen, []);
});

test('apply: 재확인 absent 와 위반이 같이 들어오면 open 으로 남는다', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  const summary = apply(
    ledger,
    results({
      commit: 'c2',
      rechecks: [{ id: VIOL_ID, verdict: 'absent', evidence: '' }],
      violations: [viol()],
    }),
  );
  assert.equal(ledger.findings[0].status, 'open');
  assert.deepEqual(summary.stillOpen, [VIOL_ID]);
  assert.deepEqual(summary.resolved, []);
  assert.deepEqual(summary.recurred, []);
});

test('apply: 형식이 틀리면 LedgerError 이고 원장이 변하지 않는다', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  ledger.findings.push({ ...ledger.findings[0], id: 'F-resolved', status: 'resolved' });
  const before = JSON.stringify(ledger);
  const bad = [
    results({ commit: '' }),
    results({ violations: 'x' }),
    results({ violations: [viol(), viol({ title: '' })] }),
    results({ violations: [viol({ source: 'explore:bug' })] }),
    results({ violations: [viol({ matches: 'F-missing' })] }),
    results({ candidates: [cand({ category: 'style' })] }),
    results({ candidates: [cand({ verdict: 'maybe' })] }),
    results({ rechecks: [{ id: 'F-missing', verdict: 'present', evidence: '' }] }),
    results({ rechecks: [{ id: 'F-resolved', verdict: 'present', evidence: '' }] }),
    results({ rechecks: [{ id: VIOL_ID, verdict: 'gone', evidence: '' }] }),
  ];
  for (const input of bad) {
    assert.throws(() => apply(ledger, input), LedgerError);
    assert.equal(JSON.stringify(ledger), before);
  }
});

test('apply: 오류 메시지가 틀린 항목의 위치를 알려준다', () => {
  const ledger = emptyLedger();
  assert.throws(
    () => apply(ledger, results({ violations: [viol(), viol({ title: '' })] })),
    /violations\[1\]/,
  );
});
