import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findingId, fileHash, init, loadLedger, saveLedger, list, apply, decide, LedgerError,
} from './ledger.mjs';

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

function rootWith(findings) {
  const root = initRoot();
  saveLedger(root, { version: 1, findings });
  return root;
}

function decisionsText(root) {
  return fs.readFileSync(path.join(root, '.review', 'decisions.md'), 'utf8');
}

test('decide: intended 는 상태를 바꾸고 결정을 기록한다', () => {
  const root = rootWith([finding({ id: 'F-1' })]);
  const ledger = loadLedger(root);
  const result = decide(root, ledger, 'F-1', 'intended', '내부 상수만 넘긴다', '2026-10-11');
  assert.deepEqual(result, { decisionId: 'D-0001', status: 'intended', decision: 'intended' });
  assert.equal(loadLedger(root).findings[0].status, 'intended');
  assert.equal(loadLedger(root).findings[0].decisionId, 'D-0001');
  assert.equal(
    decisionsText(root),
    '# 결정 기록\n' +
      '\n## D-0001\n' +
      '- 날짜: 2026-10-11\n' +
      '- 지적: F-1\n' +
      '- 대상: src/a.js foo\n' +
      '- 결정: intended\n' +
      '- 이유: 내부 상수만 넘긴다\n',
  );
});

test('decide: 결정 번호가 이어진다', () => {
  const root = rootWith([finding({ id: 'F-1' }), finding({ id: 'F-2' })]);
  const ledger = loadLedger(root);
  decide(root, ledger, 'F-1', 'intended', '이유 1', '2026-10-11');
  const second = decide(root, ledger, 'F-2', 'rejected', '이유 2', '2026-10-11');
  assert.equal(second.decisionId, 'D-0002');
});

test('decide: decisions.md 가 CRLF 여도 번호가 이어진다', () => {
  const root = rootWith([finding({ id: 'F-1' }), finding({ id: 'F-2' })]);
  const ledger = loadLedger(root);
  decide(root, ledger, 'F-1', 'intended', '이유 1', '2026-10-11');
  const file = path.join(root, '.review', 'decisions.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  const second = decide(root, ledger, 'F-2', 'rejected', '이유 2', '2026-10-11');
  assert.equal(second.decisionId, 'D-0002');
});

test('decide: 여러 줄 이유는 한 줄로 기록되고 번호를 망가뜨리지 않는다', () => {
  const root = rootWith([finding({ id: 'F-1' }), finding({ id: 'F-2' })]);
  const ledger = loadLedger(root);
  decide(root, ledger, 'F-1', 'intended', '첫 줄\n## D-0099\n셋째 줄', '2026-10-11');
  assert.match(decisionsText(root), /- 이유: 첫 줄 ## D-0099 셋째 줄\n$/);
  const second = decide(root, ledger, 'F-2', 'rejected', '이유 2', '2026-10-11');
  assert.equal(second.decisionId, 'D-0002');
});

test('decide: reopen 은 open 으로, keep 은 이전 상태로 되돌린다', () => {
  const root = rootWith([
    finding({ id: 'F-1', status: 'reopen-requested', previousStatus: 'intended' }),
    finding({ id: 'F-2', status: 'reopen-requested', previousStatus: 'rejected' }),
  ]);
  const ledger = loadLedger(root);
  assert.equal(decide(root, ledger, 'F-1', 'reopen', '상황이 바뀜', '2026-10-11').status, 'open');
  assert.equal(decide(root, ledger, 'F-2', 'keep', '그대로 둔다', '2026-10-11').status, 'rejected');
  const saved = loadLedger(root).findings;
  assert.equal('previousStatus' in saved[0], false);
  assert.equal('previousStatus' in saved[1], false);
});

test('decide: 허용되지 않은 요청은 LedgerError 이고 아무것도 쓰지 않는다', () => {
  const root = rootWith([
    finding({ id: 'F-1', status: 'open' }),
    finding({ id: 'F-2', status: 'resolved' }),
  ]);
  const ledger = loadLedger(root);
  const ledgerBefore = fs.readFileSync(path.join(root, '.review', 'findings.json'), 'utf8');
  const cases = [
    ['F-1', 'intended', ''],
    ['F-1', 'intended', '   '],
    ['F-1', 'intended', undefined],
    ['F-1', 'approve', '이유'],
    ['F-1', 'reopen', '이유'],
    ['F-1', 'keep', '이유'],
    ['F-2', 'intended', '이유'],
    ['F-missing', 'intended', '이유'],
  ];
  for (const [id, decision, reason] of cases) {
    assert.throws(() => decide(root, ledger, id, decision, reason, '2026-10-11'), LedgerError);
  }
  assert.equal(fs.readFileSync(path.join(root, '.review', 'findings.json'), 'utf8'), ledgerBefore);
  assert.equal(decisionsText(root), '# 결정 기록\n');
});

const SCRIPT = fileURLToPath(new URL('./ledger.mjs', import.meta.url));

function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('CLI: init, apply, list, decide 가 이어서 동작한다', () => {
  const root = tmpDir();
  assert.deepEqual(JSON.parse(cli(root, 'init').stdout), { created: true });
  assert.match(fs.readFileSync(path.join(root, '.review', 'rules.md'), 'utf8'), /^## R-001 /m);

  const input = path.join(root, '.review', 'results.tmp');
  fs.writeFileSync(input, JSON.stringify(results({ violations: [viol()] })));
  const applied = cli(root, 'apply', input);
  assert.equal(applied.code, 0);
  assert.deepEqual(JSON.parse(applied.stdout).new, [VIOL_ID]);

  const listed = JSON.parse(cli(root, 'list', '--files', 'src/a.js', '--status', 'open').stdout);
  assert.deepEqual(listed.map((f) => f.id), [VIOL_ID]);

  assert.deepEqual(JSON.parse(cli(root, 'id', 'R-001', 'src/a.js', 'foo').stdout), { id: VIOL_ID });

  const decided = cli(root, 'decide', VIOL_ID, 'intended', '--reason', '의도된 설계');
  assert.equal(decided.code, 0);
  assert.equal(JSON.parse(decided.stdout).status, 'intended');
});

test('CLI: 틀린 입력은 종료 코드 1 이고 원장을 건드리지 않는다', () => {
  const root = tmpDir();
  cli(root, 'init');
  const ledgerFile = path.join(root, '.review', 'findings.json');
  const before = fs.readFileSync(ledgerFile, 'utf8');

  const input = path.join(root, '.review', 'results.tmp');
  fs.writeFileSync(input, '{ 깨진 json');
  const broken = cli(root, 'apply', input);
  assert.equal(broken.code, 1);
  assert.notEqual(broken.stderr, '');

  fs.writeFileSync(input, JSON.stringify(results({ violations: [viol({ title: '' })] })));
  assert.equal(cli(root, 'apply', input).code, 1);

  assert.equal(cli(root, 'decide', 'F-missing', 'intended', '--reason', '이유').code, 1);
  assert.equal(cli(root, 'unknown').code, 1);
  assert.equal(cli(tmpDir(), 'list').code, 1);
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), before);
});

test('rules/default.md: 규칙 10개가 형식에 맞고 ID 가 겹치지 않는다', () => {
  const file = fileURLToPath(new URL('../rules/default.md', import.meta.url));
  const sections = fs.readFileSync(file, 'utf8').split(/^(?=## )/m).filter((s) => s.startsWith('## '));
  assert.equal(sections.length, 10);
  const ids = sections.map((s) => s.match(/^## (R-\d{3}) \S/)?.[1]);
  assert.equal(ids.includes(undefined), false);
  assert.equal(new Set(ids).size, 10);
  for (const section of sections) {
    assert.match(section, /^- 적용: \S/m);
    assert.match(section, /^- 설명: \S/m);
    assert.match(section, /^- 위반 예: \S/m);
  }
});

test('agents: 세 에이전트가 읽기 전용 도구만 갖는다', () => {
  for (const name of ['rule-checker', 'explorer', 'verifier']) {
    const file = fileURLToPath(new URL(`../agents/${name}.md`, import.meta.url));
    const text = fs.readFileSync(file, 'utf8');
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    assert.ok(front, `${name}: frontmatter 가 없습니다`);
    assert.match(front, new RegExp(`^name: ${name}$`, 'm'));
    assert.match(front, /^description: \S/m);
    assert.match(front, /^tools: Read, Grep, Glob$/m);
  }
});

test('skills: 두 스킬의 frontmatter 가 맞고 원장을 직접 편집하라는 지시가 없다', () => {
  const read = (name) =>
    fs.readFileSync(fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url)), 'utf8');

  const review = read('review');
  assert.match(review, /^---\nname: review\ndescription: \S/);
  for (const agent of ['rule-checker', 'explorer', 'verifier']) {
    assert.ok(review.includes(`anetos-review:${agent}`), `review: ${agent} 호출이 없습니다`);
  }
  for (const cmd of ['init', 'list', 'apply']) {
    assert.match(review, new RegExp(`ledger\\.mjs" ${cmd}`), `review: ${cmd} 명령이 없습니다`);
  }

  const decide = read('review-decide');
  assert.match(decide, /^---\nname: review-decide\ndescription: \S/);
  assert.match(decide, /^disable-model-invocation: true$/m);
  assert.match(decide, /ledger\.mjs" decide/);
});

test('apply: 같은 ID 의 후보는 순서와 상관없이 confirmed 가 이긴다', () => {
  const ledger = emptyLedger();
  const summary = apply(
    ledger,
    results({ candidates: [cand({ verdict: 'unconfirmed', title: 'A' }), cand({ title: 'B' })] }),
  );
  assert.equal(ledger.findings.length, 1);
  assert.equal(ledger.findings[0].status, 'open');
  assert.equal(ledger.findings[0].title, 'B');
  assert.deepEqual(summary.new, [CAND_ID]);
  assert.deepEqual(summary.dismissed, []);
});

test('apply: source 나 파일이 다른 지적을 가리키는 matches 는 무시한다', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  const summary = apply(
    ledger,
    results({
      commit: 'c2',
      violations: [viol({ source: 'R-003', file: 'src/zzz.js', matches: VIOL_ID })],
    }),
  );
  assert.deepEqual(summary.new, [findingId('R-003', 'src/zzz.js', 'foo')]);
  assert.deepEqual(summary.stillOpen, []);
  assert.equal(ledger.findings.length, 2);
});

test('apply: 절대 경로는 형식 오류다', () => {
  const ledger = emptyLedger();
  for (const file of ['C:\\repo\\src\\a.js', '/repo/src/a.js']) {
    assert.throws(() => apply(ledger, results({ violations: [viol({ file })] })), LedgerError);
  }
  assert.deepEqual(ledger.findings, []);
});

test('decide: 원장 저장이 실패하면 decisions.md 에 아무것도 남지 않는다', () => {
  const root = rootWith([finding({ id: 'F-1' })]);
  const ledger = loadLedger(root);
  fs.mkdirSync(path.join(root, '.review', 'findings.json.tmp'));
  assert.throws(() => decide(root, ledger, 'F-1', 'intended', '이유', '2026-10-11'));
  assert.equal(decisionsText(root), '# 결정 기록\n');
  assert.equal(loadLedger(root).findings[0].status, 'open');
});

test('skills: review 가 스테이징·미추적·삭제 파일과 후보 evidence 를 다룬다', () => {
  const review = fs.readFileSync(
    fileURLToPath(new URL('../skills/review/SKILL.md', import.meta.url)),
    'utf8',
  );
  assert.match(review, /git diff --name-only --diff-filter=d HEAD/);
  assert.match(review, /git ls-files --others --exclude-standard/);
  assert.match(review, /ledger\.mjs" list --status open/);
  assert.match(review, /`file`, `symbol`, `evidence` 는 explorer 가 낸 값을 그대로/);
});

function rootWithSource(text = 'function foo() {}\n') {
  const root = initRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), text);
  return root;
}

test('fileHash: 줄바꿈 방식이 달라도 같고 파일이 없으면 null', () => {
  const root = rootWithSource('a\nb\n');
  const lf = fileHash(root, 'src/a.js');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'a\r\nb\r\n');
  assert.equal(fileHash(root, 'src/a.js'), lf);
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'a\nc\n');
  assert.notEqual(fileHash(root, 'src/a.js'), lf);
  assert.equal(fileHash(root, 'src/missing.js'), null);
});

test('결정 후 파일이 그대로면 재검토를 요청하지 않고, 바뀌면 요청한다', () => {
  const root = rootWithSource();
  const hashOf = (file) => fileHash(root, file);
  const ledger = loadLedger(root);
  apply(ledger, results({ violations: [viol()] }), hashOf);
  saveLedger(root, ledger);
  decide(root, ledger, VIOL_ID, 'intended', '의도된 설계', '2026-10-11');

  const same = apply(ledger, results({ commit: 'c2', violations: [viol()] }), hashOf);
  assert.equal(ledger.findings[0].status, 'intended');
  assert.deepEqual(same.decided, [VIOL_ID]);
  assert.deepEqual(same.reopenRequested, []);
  assert.deepEqual(same.stillOpen, []);
  assert.deepEqual(same.new, []);

  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'function foo() { changed(); }\n');
  const changed = apply(ledger, results({ commit: 'c3', violations: [viol()] }), hashOf);
  assert.equal(ledger.findings[0].status, 'reopen-requested');
  assert.deepEqual(changed.reopenRequested, [VIOL_ID]);
  assert.deepEqual(changed.decided, []);
});

test('keep 은 현재 코드 기준으로 결정을 다시 고정하고, reopen 은 고정을 푼다', () => {
  const root = rootWithSource();
  const hashOf = (file) => fileHash(root, file);
  const ledger = loadLedger(root);
  apply(ledger, results({ violations: [viol()] }), hashOf);
  saveLedger(root, ledger);
  decide(root, ledger, VIOL_ID, 'rejected', '틀린 지적', '2026-10-11');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'function foo() { changed(); }\n');
  apply(ledger, results({ commit: 'c2', violations: [viol()] }), hashOf);

  decide(root, ledger, VIOL_ID, 'keep', '바뀐 코드에서도 유지', '2026-10-11');
  const afterKeep = apply(ledger, results({ commit: 'c3', violations: [viol()] }), hashOf);
  assert.equal(ledger.findings[0].status, 'rejected');
  assert.deepEqual(afterKeep.decided, [VIOL_ID]);

  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'function foo() { again(); }\n');
  apply(ledger, results({ commit: 'c4', violations: [viol()] }), hashOf);
  decide(root, ledger, VIOL_ID, 'reopen', '다시 본다', '2026-10-11');
  assert.equal(ledger.findings[0].status, 'open');
  assert.equal('decidedHash' in ledger.findings[0], false);
});

test('CLI: 결정 후 같은 위반을 다시 apply 해도 상태가 유지된다', () => {
  const root = tmpDir();
  cli(root, 'init');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'function foo() {}\n');
  const input = path.join(root, '.review', 'results.tmp');
  fs.writeFileSync(input, JSON.stringify(results({ violations: [viol()] })));
  cli(root, 'apply', input);
  cli(root, 'decide', VIOL_ID, 'intended', '--reason', '의도된 설계');

  const again = JSON.parse(cli(root, 'apply', input).stdout);
  assert.deepEqual(again.decided, [VIOL_ID]);
  assert.deepEqual(again.reopenRequested, []);
  assert.equal(JSON.parse(cli(root, 'list').stdout)[0].status, 'intended');
});

test('apply: 고쳐서 해결된 지적이 재발하면 fixLevel 을 지운다', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  ledger.findings[0].status = 'resolved';
  ledger.findings[0].fixLevel = 'reproduced';
  const summary = apply(ledger, results({ commit: 'c2', violations: [viol()] }));
  assert.deepEqual(summary.recurred, [VIOL_ID]);
  assert.equal(ledger.findings[0].status, 'open');
  assert.equal('fixLevel' in ledger.findings[0], false);
});

test('decide: 줄 구분 문자가 든 이유와 심볼이 결정 번호를 망가뜨리지 않는다', () => {
  const root = rootWith([
    finding({ id: 'F-1', symbol: 'foo\n## D-0500' }),
    finding({ id: 'F-2' }),
  ]);
  const ledger = loadLedger(root);
  decide(root, ledger, 'F-1', 'intended', '첫 줄\u2028## D-0099\u2029끝', '2026-10-11');
  assert.equal(decide(root, ledger, 'F-2', 'rejected', '이유', '2026-10-11').decisionId, 'D-0002');
  const headings = decisionsText(root).split(/[\n\u2028\u2029]/).filter((l) => l.startsWith('## D-'));
  assert.deepEqual(headings, ['## D-0001', '## D-0002']);
});

test('apply: file 이나 symbol 에 줄바꿈이 있으면 형식 오류다', () => {
  const ledger = emptyLedger();
  for (const over of [{ symbol: 'foo\nbar' }, { file: 'src/a.js\u2028x' }]) {
    assert.throws(() => apply(ledger, results({ violations: [viol(over)] })), LedgerError);
  }
  assert.deepEqual(ledger.findings, []);
});

test('init: 빠진 파일만 다시 만들고 있는 파일은 건드리지 않는다', () => {
  const root = tmpDir();
  const plugin = fakePlugin();
  init(root, plugin);
  const dir = path.join(root, '.review');
  fs.writeFileSync(path.join(dir, 'rules.md'), '## R-900 프로젝트 규칙\n');
  fs.rmSync(path.join(dir, 'findings.json'));
  fs.rmSync(path.join(dir, 'decisions.md'));
  assert.deepEqual(init(root, plugin), {
    created: false,
    repaired: ['findings.json', 'decisions.md'],
  });
  assert.equal(fs.readFileSync(path.join(dir, 'rules.md'), 'utf8'), '## R-900 프로젝트 규칙\n');
  assert.deepEqual(loadLedger(root).findings, []);
  assert.equal(decisionsText(root), '# 결정 기록\n');
});

test('BOM 이 붙은 원장과 결과 파일을 읽는다', () => {
  const root = tmpDir();
  cli(root, 'init');
  const ledgerFile = path.join(root, '.review', 'findings.json');
  fs.writeFileSync(ledgerFile, '\uFEFF' + fs.readFileSync(ledgerFile, 'utf8'));
  assert.deepEqual(loadLedger(root).findings, []);
  const input = path.join(root, '.review', 'results.tmp');
  fs.writeFileSync(input, '\uFEFF' + JSON.stringify(results({ violations: [viol()] })));
  const applied = cli(root, 'apply', input);
  assert.equal(applied.code, 0, applied.stderr);
});

test('apply: 배열에 객체가 아닌 것이 있으면 LedgerError', () => {
  for (const key of ['rechecks', 'violations', 'candidates']) {
    assert.throws(() => apply(emptyLedger(), results({ [key]: [null] })), LedgerError);
  }
});

test('decide: decisions.md 가 없으면 새로 만든다', () => {
  const root = rootWith([finding({ id: 'F-1' })]);
  fs.rmSync(path.join(root, '.review', 'decisions.md'));
  const result = decide(root, loadLedger(root), 'F-1', 'intended', '이유', '2026-10-11');
  assert.equal(result.decisionId, 'D-0001');
  assert.match(decisionsText(root), /^# 결정 기록\n\n## D-0001\n/);
});

test('apply: 같은 지적의 재확인이 엇갈리면 순서와 상관없이 present 가 이기고 위치를 갱신한다', () => {
  for (const order of [['absent', 'present'], ['present', 'absent']]) {
    const ledger = emptyLedger();
    apply(ledger, results({ violations: [viol()] }));
    const summary = apply(
      ledger,
      results({
        commit: 'c2',
        rechecks: order.map((verdict) => ({
          id: VIOL_ID,
          verdict,
          evidence: verdict === 'present' ? 'src/a.js:77' : '',
        })),
      }),
    );
    assert.equal(ledger.findings[0].status, 'open');
    assert.equal(ledger.findings[0].evidence, 'src/a.js:77');
    assert.deepEqual(summary.stillOpen, [VIOL_ID]);
    assert.deepEqual(summary.resolved, []);
  }
});

test('apply: reopen-requested 지적도 재확인해서 없어졌으면 resolved 로 바꾼다', () => {
  const ledger = emptyLedger();
  apply(ledger, results({ violations: [viol()] }));
  Object.assign(ledger.findings[0], { status: 'reopen-requested', previousStatus: 'intended' });

  const present = apply(
    ledger,
    results({ commit: 'c2', rechecks: [{ id: VIOL_ID, verdict: 'present', evidence: '' }] }),
  );
  assert.equal(ledger.findings[0].status, 'reopen-requested');
  assert.deepEqual(present.reopenRequested, [VIOL_ID]);
  assert.deepEqual(present.stillOpen, []);

  const absent = apply(
    ledger,
    results({ commit: 'c3', rechecks: [{ id: VIOL_ID, verdict: 'absent', evidence: '' }] }),
  );
  assert.equal(ledger.findings[0].status, 'resolved');
  assert.equal('previousStatus' in ledger.findings[0], false);
  assert.deepEqual(absent.resolved, [VIOL_ID]);
});

function appliedRoot() {
  const root = tmpDir();
  cli(root, 'init');
  const input = path.join(root, '.review', 'results.tmp');
  fs.writeFileSync(
    input,
    JSON.stringify(results({ violations: [viol()], candidates: [cand({ verdict: 'unconfirmed' })] })),
  );
  assert.equal(cli(root, 'apply', input).code, 0);
  return root;
}

test('CLI: 옵션 형식을 엄격하게 받는다', () => {
  const root = appliedRoot();
  const ids = (r) => JSON.parse(r.stdout).map((f) => f.id);

  assert.equal(cli(root, 'list', '--files').code, 1);
  assert.equal(cli(root, 'list', '--files', ' , ').code, 1);
  assert.equal(cli(root, 'list', '--status', 'opne').code, 1);
  assert.equal(cli(root, 'list', '--nope', 'x').code, 1);
  assert.deepEqual(ids(cli(root, 'list', '--files', 'src/b.js, src/a.js', '--status', 'open')), [VIOL_ID]);
  assert.deepEqual(ids(cli(root, 'list', '--status=dismissed')), [CAND_ID]);
  assert.deepEqual(ids(cli(root, 'list', '--ids', `F-none, ${VIOL_ID}`)), [VIOL_ID]);

  const weird = cli(root, 'decide', VIOL_ID, 'toString', '--reason', '이유');
  assert.equal(weird.code, 1);
  assert.match(weird.stderr, /알 수 없는 결정/);
  const decided = cli(root, 'decide', VIOL_ID, 'intended', '--reason=의도된 설계');
  assert.equal(decided.code, 0, decided.stderr);
  assert.deepEqual(JSON.parse(decided.stdout), {
    decisionId: 'D-0001',
    status: 'intended',
    decision: 'intended',
  });
});

test('CLI: --reason-file 은 이유를 셸 해석 없이 그대로 기록한다', () => {
  const root = appliedRoot();
  const reason = '값은 $HOME 과 `whoami` 와 "따옴표" 와 \'작은따옴표\' 를 그대로 둔다';
  const file = path.join(root, '.review', 'reason.tmp');
  fs.writeFileSync(file, `\uFEFF${reason}\n`);
  const decided = cli(root, 'decide', VIOL_ID, 'intended', '--reason-file', file);
  assert.equal(decided.code, 0, decided.stderr);
  assert.ok(decisionsText(root).endsWith(`- 이유: ${reason}\n`));

  const again = appliedRoot();
  assert.equal(cli(again, 'decide', VIOL_ID, 'intended', '--reason-file', 'missing.tmp').code, 1);
  assert.equal(
    cli(again, 'decide', VIOL_ID, 'intended', '--reason', 'a', '--reason-file', file).code,
    1,
  );
});

test('CLI: ids 는 후보의 ID 와 현재 상태를 돌려준다', () => {
  const root = appliedRoot();
  const input = path.join(root, '.review', 'ids.tmp');
  fs.writeFileSync(
    input,
    JSON.stringify([
      { source: 'R-001', file: 'src\\a.js', symbol: 'foo' },
      { category: 'bug', file: 'src/a.js', symbol: 'bar' },
      { category: 'bug', file: 'src/a.js', symbol: '$scope' },
    ]),
  );
  const r = cli(root, 'ids', input);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { id: VIOL_ID, status: 'open' },
    { id: CAND_ID, status: 'dismissed' },
    { id: findingId('explore:bug', 'src/a.js', '$scope'), status: null },
  ]);
  fs.writeFileSync(input, JSON.stringify([{ file: 'src/a.js' }]));
  assert.equal(cli(root, 'ids', input).code, 1);
});

test('문서: 1차 Minor 정리가 스킬과 에이전트에 반영돼 있다', () => {
  const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
  const review = read('skills/review/SKILL.md');
  assert.match(review, /ledger\.mjs" ids /);
  assert.match(review, /ledger\.mjs" list --ids /);
  assert.match(review, /ledger\.mjs" list --status reopen-requested/);
  assert.equal(/ledger\.mjs" id "/.test(review), false);

  const decideSkill = read('skills/review-decide/SKILL.md');
  assert.match(decideSkill, /--reason-file/);
  assert.equal(/--reason "/.test(decideSkill), false);
  assert.match(decideSkill, /기존 결정을 유지/);

  assert.match(read('agents/explorer.md'), /따라가는 과정은 쓰지 않는다/);
});
