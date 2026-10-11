# anetos-review 1차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고정 규칙 검사, 검증된 자유 탐색, 결정 기록으로 실행할수록 결과가 수렴하는 Claude Code 코드리뷰 플러그인(`anetos-review`)의 1차 범위를 만든다.

**Architecture:** 판단은 서브에이전트 세 개(rule-checker, explorer, verifier)가 JSON으로 반환하고, 메인 세션이 `review` 스킬의 절차에 따라 결과를 모은다. 대상 저장소의 `.review/` 상태는 의존성 없는 Node 스크립트 `ledger.mjs`만 읽고 쓴다. ID 계산과 상태 전이는 전부 이 스크립트 안에 있어 단위 테스트로 고정된다.

**Tech Stack:** Node.js 20 이상(내장 `node:test`, `node:crypto`, `node:fs`), Claude Code 플러그인(skills, agents). 외부 패키지 없음.

**Spec:** `docs/superpowers/specs/2026-10-11-anetos-review-phase1-design.md`

## Global Constraints

- 플러그인 파일은 전부 `C:\dev\anetos\anetos-review\` 아래에 둔다.
- `ledger.mjs`는 외부 의존성이 없어야 한다. `package.json`과 `node_modules`를 만들지 않는다.
- `.review/findings.json`과 `.review/decisions.md`는 `ledger.mjs`만 쓴다. 스킬과 에이전트 문서 어디에도 이 파일을 직접 편집하라는 지시를 넣지 않는다.
- 지적 ID는 `F-` + `sha1(source|file|symbol)`의 앞 8자리다. 줄 번호를 ID 계산에 쓰지 않는다.
- 상태는 `open`, `resolved`, `intended`, `rejected`, `dismissed`, `reopen-requested` 여섯 가지뿐이다.
- 자유 탐색의 분류는 `bug`, `security`, `data-loss`, `concurrency` 네 가지뿐이다.
- `decisions.md`는 추가 전용이다. 기존 항목을 고치지 않는다.
- 규칙 ID(`R-001` 등)는 한 번 부여하면 바꾸거나 재사용하지 않는다.
- 서브에이전트는 원장을 쓰지 않고, 반환은 JSON만 한다.
- explorer는 실행당 하나만 띄운다. rule-checker는 범위 파일이 10개를 넘을 때만 나눈다.
- 1차에서는 코드를 수정하지 않는다. 스킬은 수정을 제안하지도 실행하지도 않는다.
- 사용자에게 보이는 문구(오류 메시지, 스킬·에이전트 본문)는 한국어로 쓴다.
- 플러그인 스킬의 호출 이름은 네임스페이스가 붙어 `/anetos-review:review`, `/anetos-review:review-decide`가 된다. 스펙의 `/review`, `/review-decide`는 이것을 가리킨다.

## Review Focus

스펙이 직접 말하지 않지만 실제 사용에서 걸릴 가능성이 높은 다섯 가지다. 각각 해당 Task에 테스트를 넣었다.

1. **Windows 역슬래시 경로**: `src\db\user.ts`와 `src/db/user.ts`는 같은 ID가 나와야 한다. (Task 1)
2. **한 번의 apply에 같은 문제가 두 번 들어옴**: 분할된 rule-checker 두 개가 같은 위반을 보고해도 지적은 하나만 생겨야 한다. (Task 3)
3. **재확인은 "없음", 규칙 검사는 "있음"**: 같은 실행에서 판정이 엇갈리면 지적은 `open`으로 남아야 하고, "해결됨"이나 "재발"로 보고되면 안 된다. (Task 3)
4. **CRLF로 체크아웃된 `decisions.md`**: git의 줄바꿈 변환 뒤에도 결정 번호가 이어져야 한다. `D-0001`이 중복되면 안 된다. (Task 4)
5. **여러 줄로 된 결정 이유**: 이유에 줄바꿈이나 `## D-` 같은 문자열이 있어도 `decisions.md`의 항목 구조가 깨지지 않아야 한다. (Task 4)

---

## File Structure

| 파일 | 책임 |
|---|---|
| `anetos-review/.claude-plugin/plugin.json` | 플러그인 메타데이터 |
| `anetos-review/scripts/ledger.mjs` | 원장 조작 전부: ID, init, list, apply, decide, CLI |
| `anetos-review/scripts/ledger.test.mjs` | 위 스크립트의 단위 테스트 |
| `anetos-review/rules/default.md` | 기본 규칙 10개. `init`이 대상 저장소로 복사한다 |
| `anetos-review/agents/rule-checker.md` | 규칙별 위반 판정 |
| `anetos-review/agents/explorer.md` | 규칙 밖 후보 탐색 |
| `anetos-review/agents/verifier.md` | 후보 검증과 기존 지적 재확인 |
| `anetos-review/skills/review/SKILL.md` | 리뷰 절차(오케스트레이터) |
| `anetos-review/skills/review-decide/SKILL.md` | 사람의 결정 기록 |
| `anetos-review/fixtures/sample-repo/src/*.js` | 문제를 심어 둔 측정용 코드 |
| `anetos-review/fixtures/EXPECTED.md` | 심은 문제 목록과 측정 절차·결과 |

테스트 실행 명령은 모든 Task에서 같다. `C:\dev\anetos`에서 실행한다.

```bash
node --test anetos-review/scripts/
```

---

### Task 1: 저장소 뼈대, 지적 ID, init

**Files:**
- Create: `anetos-review/.claude-plugin/plugin.json`
- Create: `anetos-review/scripts/ledger.mjs`
- Create: `anetos-review/scripts/ledger.test.mjs`
- Create: `.gitignore`
- Create: `.gitattributes`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `VERSION: number` (값 `1`), `DIR: string` (값 `'.review'`)
  - `class LedgerError extends Error`
  - `normFile(file: string): string` — 역슬래시를 슬래시로, 앞의 `./` 제거
  - `findingId(source: string, file: string, symbol: string): string` — `F-xxxxxxxx`
  - `init(root: string, pluginRoot: string): { created: boolean }`

- [ ] **Step 1: git 저장소와 플러그인 메타데이터 만들기**

```bash
cd /c/dev/anetos && git init
```

`.gitignore`:

```
node_modules/
*.tmp
```

`.gitattributes` (Windows에서 체크아웃할 때 줄바꿈이 CRLF로 바뀌면 frontmatter를 읽는 테스트와 스킬 로딩이 흔들리므로 LF로 고정한다):

```
* text=auto eol=lf
```

`anetos-review/.claude-plugin/plugin.json`:

```json
{
  "name": "anetos-review",
  "version": "0.1.0",
  "description": "고정 규칙 검사와 결정 기록으로 실행할수록 결과가 수렴하는 코드 리뷰"
}
```

- [ ] **Step 2: 실패하는 테스트 쓰기**

`anetos-review/scripts/ledger.test.mjs`:

```js
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
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: FAIL. `Cannot find module` 또는 `ledger.mjs`를 찾을 수 없다는 오류.

- [ ] **Step 4: 최소 구현 쓰기**

`anetos-review/scripts/ledger.mjs`:

```js
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

export function init(root, pluginRoot) {
  const dir = path.join(root, DIR);
  if (fs.existsSync(dir)) return { created: false };
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(pluginRoot, 'rules', 'default.md'), path.join(dir, 'rules.md'));
  fs.writeFileSync(
    path.join(dir, 'findings.json'),
    JSON.stringify({ version: VERSION, findings: [] }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'decisions.md'), '# 결정 기록\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.tmp\n');
  return { created: true };
}
```

`fileURLToPath`는 Task 4에서 쓴다. 지금은 import만 해 둔다.

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: PASS. 5개 통과, 0개 실패.

- [ ] **Step 6: 커밋**

```bash
git add .gitignore .gitattributes docs anetos-review
git commit -m "feat: anetos-review 뼈대와 지적 ID, init 추가"
```

---

### Task 2: 원장 읽기·쓰기와 list

**Files:**
- Modify: `anetos-review/scripts/ledger.mjs` (끝에 추가)
- Modify: `anetos-review/scripts/ledger.test.mjs` (끝에 추가, import 줄 수정)

**Interfaces:**
- Consumes: `VERSION`, `DIR`, `LedgerError`, `normFile`, `init`
- Produces:
  - `loadLedger(root: string): { version: 1, findings: Finding[] }` — 파일이 없거나, JSON이 깨졌거나, `version`이 다르면 `LedgerError`
  - `saveLedger(root: string, ledger): void` — 임시 파일에 쓴 뒤 이름 변경
  - `list(ledger, opts?: { files?: string[], status?: string }): Finding[]`
  - `Finding`: `{ id, source, file, symbol, title, evidence, status, firstSeen, lastChecked, decisionId, previousStatus? }`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`ledger.test.mjs`의 import 줄을 다음으로 바꾼다.

```js
import { findingId, init, loadLedger, saveLedger, list, LedgerError } from './ledger.mjs';
```

파일 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: FAIL. `loadLedger`를 export하지 않는다는 SyntaxError.

- [ ] **Step 3: 구현 추가**

`ledger.mjs` 끝에 추가한다.

```js
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
    data = JSON.parse(raw);
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

export function list(ledger, { files, status } = {}) {
  const wanted = files && new Set(files.map(normFile));
  return ledger.findings.filter(
    (f) => (!wanted || wanted.has(f.file)) && (!status || f.status === status),
  );
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: PASS. 10개 통과, 0개 실패.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/scripts
git commit -m "feat: 원장 읽기·쓰기와 list 추가"
```

---

### Task 3: apply (결과 병합과 상태 전이)

**Files:**
- Modify: `anetos-review/scripts/ledger.mjs` (끝에 추가)
- Modify: `anetos-review/scripts/ledger.test.mjs` (끝에 추가, import 줄 수정)

**Interfaces:**
- Consumes: `findingId`, `normFile`, `LedgerError`
- Produces:
  - `apply(ledger, results): Summary` — `ledger`를 제자리에서 고친다. 입력이 틀리면 아무것도 고치지 않고 `LedgerError`를 던진다.
  - `results` 형식 (`review` 스킬이 이 형식으로 조립한다):

    ```json
    {
      "commit": "<커밋 해시 또는 uncommitted>",
      "rechecks":   [{ "id": "F-...", "verdict": "present|absent", "evidence": "..." }],
      "violations": [{ "source": "R-001", "file": "...", "symbol": "...", "title": "...", "evidence": "...", "matches": "F-...|null" }],
      "candidates": [{ "category": "bug|security|data-loss|concurrency", "file": "...", "symbol": "...", "title": "...", "evidence": "...", "matches": "F-...|null", "verdict": "confirmed|unconfirmed" }]
    }
    ```
  - `Summary`: `{ new: string[], stillOpen: string[], resolved: string[], recurred: string[], reopenRequested: string[], dismissed: string[] }` — 값은 지적 ID 배열

동작 규칙 (스펙 4.4, 5절):

| 들어온 것 | 원장의 현재 상태 | 결과 |
|---|---|---|
| 위반 또는 확인된 후보 | 없음 | `open`으로 새로 등록, `new` |
| 위반 또는 확인된 후보 | `open` | 그대로, `stillOpen` |
| 위반 또는 확인된 후보 | `resolved` | `open`, `recurred` |
| 위반 또는 확인된 후보 | `intended`/`rejected` | `reopen-requested`, `previousStatus`에 이전 상태 저장 |
| 위반 또는 확인된 후보 | `reopen-requested` | 그대로, `reopenRequested` |
| 위반 또는 확인된 후보 | `dismissed` | 그대로, 어느 묶음에도 넣지 않음 |
| 확인 안 된 후보 | 없음 | `dismissed`로 새로 등록, `dismissed` |
| 확인 안 된 후보 | 있음 | 그대로 |
| 재확인 `present` | `open` | 그대로, `stillOpen` |
| 재확인 `absent` | `open` | `resolved`. 단 같은 ID가 위반으로도 들어왔으면 `open` 유지, `stillOpen` |

- [ ] **Step 1: 실패하는 테스트 쓰기**

import 줄을 다음으로 바꾼다.

```js
import { findingId, init, loadLedger, saveLedger, list, apply, LedgerError } from './ledger.mjs';
```

파일 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: FAIL. `apply`를 export하지 않는다는 SyntaxError.

- [ ] **Step 3: 구현 추가**

`ledger.mjs` 끝에 추가한다.

```js
const CATEGORIES = ['bug', 'security', 'data-loss', 'concurrency'];

function validateResults(ledger, results) {
  if (!results || typeof results !== 'object') return ['결과가 객체가 아닙니다'];
  const errors = [];
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  if (!filled(results.commit)) errors.push('commit: 비어 있지 않은 문자열이어야 합니다');
  for (const key of ['rechecks', 'violations', 'candidates']) {
    if (!Array.isArray(results[key])) errors.push(`${key}: 배열이어야 합니다`);
  }
  if (errors.length) return errors;

  const statusById = new Map(ledger.findings.map((f) => [f.id, f.status]));
  const checkHit = (hit, at) => {
    for (const key of ['file', 'symbol', 'title', 'evidence']) {
      if (!filled(hit[key])) errors.push(`${at}: ${key} 가 비어 있습니다`);
    }
    if (hit.matches != null && !statusById.has(hit.matches)) {
      errors.push(`${at}: matches 가 원장에 없는 id 를 가리킵니다 (${hit.matches})`);
    }
  };

  results.rechecks.forEach((r, i) => {
    const at = `rechecks[${i}]`;
    if (!statusById.has(r.id)) errors.push(`${at}: 원장에 없는 id 입니다 (${r.id})`);
    else if (statusById.get(r.id) !== 'open') {
      errors.push(`${at}: ${r.id} 의 상태가 open 이 아닙니다 (${statusById.get(r.id)})`);
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

export function apply(ledger, results) {
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
    dismissed: new Set(),
  };

  const hits = [
    ...results.violations.map((v) => ({ ...v, confirmed: true })),
    ...results.candidates.map((c) => ({
      ...c,
      source: `explore:${c.category}`,
      confirmed: c.verdict === 'confirmed',
    })),
  ].map((h) => ({
    ...h,
    file: normFile(h.file),
    id: h.matches ?? findingId(h.source, h.file, h.symbol),
  }));
  const confirmedIds = new Set(hits.filter((h) => h.confirmed).map((h) => h.id));

  for (const r of results.rechecks) {
    const f = byId.get(r.id);
    f.lastChecked = commit;
    if (r.verdict === 'present' || confirmedIds.has(r.id)) {
      summary.stillOpen.add(r.id);
    } else {
      f.status = 'resolved';
      summary.resolved.add(r.id);
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
      summary.recurred.add(h.id);
    } else if (f.status === 'intended' || f.status === 'rejected') {
      f.previousStatus = f.status;
      f.status = 'reopen-requested';
      summary.reopenRequested.add(h.id);
    } else if (f.status === 'reopen-requested') {
      summary.reopenRequested.add(h.id);
    }
  }

  return Object.fromEntries(Object.entries(summary).map(([key, ids]) => [key, [...ids]]));
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: PASS. 22개 통과, 0개 실패.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/scripts
git commit -m "feat: 리뷰 결과를 원장에 병합하는 apply 추가"
```

---

### Task 4: decide와 CLI

**Files:**
- Modify: `anetos-review/scripts/ledger.mjs` (끝에 추가)
- Modify: `anetos-review/scripts/ledger.test.mjs` (끝에 추가, import 줄 수정)

**Interfaces:**
- Consumes: `loadLedger`, `saveLedger`, `list`, `apply`, `init`, `findingId`, `LedgerError`, `DIR`
- Produces:
  - `decide(root, ledger, id, decision, reason, date?): { decisionId: string, status: string }` — `decision`은 `intended | rejected | reopen | keep`. `findings.json`을 저장하고 `decisions.md`에 항목을 추가한다.
  - CLI (대상 저장소 루트에서 실행, 출력은 JSON, 실패 시 표준 오류에 메시지를 쓰고 종료 코드 1):
    - `node ledger.mjs init` → `{ "created": true|false }`
    - `node ledger.mjs list [--files a,b] [--status s]` → `Finding[]`
    - `node ledger.mjs id <source> <file> <symbol>` → `{ "id": "F-..." }`
    - `node ledger.mjs apply <결과 파일>` → `Summary`
    - `node ledger.mjs decide <id> <결정> --reason "..."` → `{ "decisionId", "status" }`

결정별 허용 상태 (스펙 4.4, 6절):

| 결정 | 필요한 현재 상태 | 바뀐 상태 |
|---|---|---|
| `intended` | `open` | `intended` |
| `rejected` | `open` | `rejected` |
| `reopen` | `reopen-requested` | `open` |
| `keep` | `reopen-requested` | `previousStatus`에 저장된 상태 |

- [ ] **Step 1: 실패하는 테스트 쓰기**

import 줄을 다음으로 바꾸고, `spawnSync` import를 추가한다.

```js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findingId, init, loadLedger, saveLedger, list, apply, decide, LedgerError,
} from './ledger.mjs';
```

파일 끝에 추가한다.

```js
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
  assert.deepEqual(result, { decisionId: 'D-0001', status: 'intended' });
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
```

`CLI: init...` 테스트는 플러그인의 실제 `rules/default.md`를 복사한다. 이 파일은 Task 5에서 만들므로, 이 Task에서는 다음 한 줄짜리 파일을 먼저 만들어 둔다. Task 5가 내용을 채운다.

`anetos-review/rules/default.md`:

```markdown
## R-001 외부 입력을 검증 없이 쿼리·명령·경로에 넣지 않는다
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: FAIL. `decide`를 export하지 않는다는 SyntaxError.

- [ ] **Step 3: 구현 추가**

`ledger.mjs` 끝에 추가한다.

```js
const DECISIONS = {
  intended: 'open',
  rejected: 'open',
  reopen: 'reopen-requested',
  keep: 'reopen-requested',
};

export function decide(root, ledger, id, decision, reason, date = new Date().toISOString().slice(0, 10)) {
  const required = DECISIONS[decision];
  if (!required) {
    throw new LedgerError(`알 수 없는 결정입니다: ${decision} (intended, rejected, reopen, keep 중 하나)`);
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new LedgerError('이유는 필수입니다. --reason "..." 으로 적어 주세요.');
  }
  const f = ledger.findings.find((x) => x.id === id);
  if (!f) throw new LedgerError(`원장에 없는 id 입니다: ${id}`);
  if (f.status !== required) {
    throw new LedgerError(
      `${id} 의 상태가 ${f.status} 이라 ${decision} 결정을 할 수 없습니다 (${required} 상태여야 합니다).`,
    );
  }

  const file = path.join(root, DIR, 'decisions.md');
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

  const oneLine = reason.trim().replace(/\s*[\r\n]+\s*/g, ' ');
  fs.appendFileSync(
    file,
    `\n## ${decisionId}\n- 날짜: ${date}\n- 지적: ${id}\n- 대상: ${f.file} ${f.symbol}\n- 결정: ${decision}\n- 이유: ${oneLine}\n`,
  );
  saveLedger(root, ledger);
  return { decisionId, status: f.status };
}

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = '사용법: ledger.mjs <init | list [--files a,b] [--status s] | id <source> <file> <symbol> | apply <결과 파일> | decide <id> <결정> --reason "...">';

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opts };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const { pos, opts } = parseArgs(rest);
  const root = process.cwd();
  const out = (value) => console.log(JSON.stringify(value, null, 2));

  switch (cmd) {
    case 'init':
      return out(init(root, PLUGIN_ROOT));
    case 'id':
      if (pos.length !== 3) throw new LedgerError(USAGE);
      return out({ id: findingId(pos[0], pos[1], pos[2]) });
    case 'list':
      return out(
        list(loadLedger(root), {
          files: opts.files?.split(',').filter(Boolean),
          status: opts.status,
        }),
      );
    case 'apply': {
      if (pos.length !== 1) throw new LedgerError(USAGE);
      let results;
      try {
        results = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
      } catch (e) {
        throw new LedgerError(`결과 파일을 읽을 수 없습니다: ${e.message}`);
      }
      const ledger = loadLedger(root);
      const summary = apply(ledger, results);
      saveLedger(root, ledger);
      return out(summary);
    }
    case 'decide': {
      if (pos.length !== 2) throw new LedgerError(USAGE);
      return out(decide(root, loadLedger(root), pos[0], pos[1], opts.reason));
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
```

`## D-0099`가 이유 안에 들어가도 번호가 안전한 이유: 이유를 한 줄로 합치면 그 문자열이 줄의 맨 앞에 오지 않으므로 `^## D-(\d+)\s*$` 에 걸리지 않는다.

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: PASS. 30개 통과, 0개 실패.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/scripts anetos-review/rules
git commit -m "feat: 결정 기록 decide 와 ledger CLI 추가"
```

---

### Task 5: 기본 규칙

**Files:**
- Modify: `anetos-review/rules/default.md` (전체 교체)
- Modify: `anetos-review/scripts/ledger.test.mjs` (끝에 추가)

**Interfaces:**
- Consumes: 없음
- Produces: 규칙 섹션 형식. rule-checker(Task 6)와 `review` 스킬(Task 7)이 이 형식을 읽는다.
  - 제목: `## R-NNN <한 문장>`
  - 필수 줄: `- 적용: <glob>`, `- 설명: ...`, `- 위반 예: ...`
  - 선택 줄: `- 상태: 폐기` (있으면 검사하지 않는다)

- [ ] **Step 1: 실패하는 테스트 쓰기**

`ledger.test.mjs` 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: FAIL. `1 !== 10`.

- [ ] **Step 3: 규칙 쓰기**

`anetos-review/rules/default.md` 전체를 다음으로 바꾼다.

```markdown
# 리뷰 규칙

규칙 하나가 섹션 하나다. 규칙 ID는 바꾸거나 재사용하지 않는다. 규칙을 없앨 때는 섹션을 지우지 말고 `- 상태: 폐기` 줄을 붙인다. 프로젝트 고유 규칙은 R-100부터 번호를 붙인다.

## R-001 외부 입력을 검증 없이 쿼리·명령·경로에 넣지 않는다
- 적용: **/*
- 설명: 사용자 입력, 요청 파라미터, 파일 내용처럼 프로그램 밖에서 온 값을 SQL, 셸 명령, 파일 경로, HTML에 그대로 이어 붙이지 않는다. 파라미터 바인딩, 이스케이프, 허용 목록 검증 중 하나를 거쳐야 한다.
- 위반 예: 요청에서 받은 이름을 문자열 연결로 SQL 문에 넣는다.

## R-002 비밀 값을 코드나 로그에 넣지 않는다
- 적용: **/*
- 설명: API 키, 비밀번호, 토큰, 개인 키를 소스에 상수로 적거나 로그·오류 메시지에 출력하지 않는다. 예시용 자리표시자(`YOUR_API_KEY` 등)는 위반이 아니다.
- 위반 예: 실제 형태의 API 키가 문자열 상수로 들어 있다.

## R-003 오류를 조용히 삼키지 않는다
- 적용: **/*
- 설명: 잡은 오류는 처리하거나, 기록하거나, 다시 던져야 한다. 아무것도 하지 않는 catch 블록, 오류를 무시하고 기본값을 돌려주면서 흔적을 남기지 않는 코드는 위반이다.
- 위반 예: catch 블록이 비어 있거나 `return null`만 있다.

## R-004 실패할 수 있는 호출의 결과를 확인하고 쓴다
- 적용: **/*
- 설명: 없을 수 있는 값(null, undefined, 빈 결과, 오류 반환)을 돌려주는 호출의 결과를 확인 없이 역참조하지 않는다.
- 위반 예: 조회 결과가 없을 수 있는데 바로 필드에 접근한다.

## R-005 획득한 자원은 모든 경로에서 해제한다
- 적용: **/*
- 설명: 파일 핸들, 연결, 잠금, 타이머는 정상 경로와 오류 경로 모두에서 해제되어야 한다.
- 위반 예: 파일을 연 뒤 중간에 예외가 나면 닫지 않고 빠져나간다.

## R-006 공유 상태의 확인과 변경은 한 단위로 한다
- 적용: **/*
- 설명: 여러 실행 흐름이 함께 쓰는 상태를 "확인한 뒤 변경"할 때, 그 사이에 다른 흐름이 끼어들 수 없어야 한다. 비동기 대기(await) 사이에 걸친 확인-변경도 해당한다.
- 위반 예: 잔액을 읽고, 비동기 호출을 기다린 뒤, 읽어 둔 값에서 빼서 저장한다.

## R-007 외부 호출에는 제한 시간을 둔다
- 적용: **/*
- 설명: 네트워크 요청, 외부 프로세스 실행, 다른 서비스 호출에는 제한 시간이 있어야 한다. 라이브러리의 기본 제한 시간이 유한하다는 근거가 코드에 있으면 통과다.
- 위반 예: 제한 시간 없이 HTTP 요청을 보내고 응답을 기다린다.

## R-008 경계값에서 인덱스와 반복이 범위를 벗어나지 않는다
- 적용: **/*
- 설명: 빈 컬렉션, 길이 1, 마지막 원소에서 인덱스 접근과 반복 조건이 범위 안에 있어야 한다. 0으로 나누는 경우도 포함한다.
- 위반 예: 반복 조건이 `i <= arr.length`라서 마지막에 범위 밖을 읽는다.

## R-009 인증·권한 확인을 건너뛰는 경로가 없다
- 적용: **/*
- 설명: 보호되어야 하는 동작에 이르는 모든 경로가 인증과 권한 확인을 거쳐야 한다. 같은 자원에 대한 다른 진입점이 확인을 생략하면 위반이다.
- 위반 예: 조회 핸들러는 소유자를 확인하는데 삭제 핸들러는 확인하지 않는다.

## R-010 파괴적 동작은 대상을 확인한 뒤 수행한다
- 적용: **/*
- 설명: 삭제, 덮어쓰기, 초기화는 대상이 의도한 범위 안에 있는지 확인한 뒤 수행한다. 빈 문자열이나 루트 경로가 대상이 될 수 있으면 위반이다.
- 위반 예: 인자로 받은 경로를 검사 없이 재귀 삭제한다.
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: PASS. 31개 통과, 0개 실패.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/rules anetos-review/scripts
git commit -m "feat: 기본 리뷰 규칙 10개 추가"
```

---

### Task 6: 서브에이전트 세 개

**Files:**
- Create: `anetos-review/agents/rule-checker.md`
- Create: `anetos-review/agents/explorer.md`
- Create: `anetos-review/agents/verifier.md`
- Modify: `anetos-review/scripts/ledger.test.mjs` (끝에 추가)

**Interfaces:**
- Consumes: Task 5의 규칙 형식
- Produces: 에이전트 이름과 반환 형식. `review` 스킬(Task 7)이 `anetos-review:rule-checker`, `anetos-review:explorer`, `anetos-review:verifier`로 호출한다.
  - rule-checker 반환: `[{ ruleId, file, symbol, verdict: "violation"|"pass"|"n/a", evidence, title, matches }]`
  - explorer 반환: `[{ category, file, symbol, claim, evidence, matches }]`
  - verifier 반환(후보 검증): `{ verdict: "confirmed"|"unconfirmed", scenario, evidence }`
  - verifier 반환(재확인): `{ verdict: "present"|"absent", evidence }`

- [ ] **Step 1: 실패하는 테스트 쓰기**

에이전트 문서는 프롬프트라서 동작을 단위 테스트할 수 없다. 여기서는 파일이 있고, frontmatter가 맞고, 읽기 전용 도구만 갖는지를 고정한다. 동작은 Task 8의 측정으로 확인한다.

`ledger.test.mjs` 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: FAIL. `ENOENT ... agents/rule-checker.md`.

- [ ] **Step 3: rule-checker 쓰기**

`anetos-review/agents/rule-checker.md`:

````markdown
---
name: rule-checker
description: 주어진 규칙 목록과 파일 목록에 대해 규칙별로 위반 여부를 판정한다. anetos-review 의 review 스킬이 호출한다.
tools: Read, Grep, Glob
---

당신은 코드 리뷰의 규칙 검사 담당이다. 받은 규칙을 받은 파일에 적용해 규칙마다 판정을 내린다.

## 받는 것

- 규칙 목록: 각 규칙의 ID, 제목, 설명, 위반 예
- 파일 목록: 검사할 파일의 경로
- 기존 지적 목록: 이 파일들에 이미 등록된 지적의 `id`, `source`, `symbol`, `title`

## 하는 일

1. 받은 파일을 전부 읽는다. 위반 여부를 판단하는 데 필요하면 그 파일이 호출하거나 호출되는 다른 파일도 읽는다.
2. 규칙을 하나씩, 목록의 순서대로 적용한다. 규칙 하나를 끝내기 전에 다음 규칙으로 넘어가지 않는다.
3. 규칙과 파일의 조합마다 판정을 하나 낸다.
   - `violation`: 규칙을 어긴 코드가 있다. 어긴 위치를 `파일:줄` 로 댈 수 있어야 한다.
   - `pass`: 규칙이 다루는 종류의 코드가 있고, 어기지 않았다.
   - `n/a`: 규칙이 다루는 종류의 코드가 이 파일에 없다.
4. 한 파일에서 같은 규칙을 여러 군데가 어기면 심볼마다 `violation` 항목을 따로 낸다.

## 지켜야 할 것

- 받은 규칙만 판정한다. 규칙에 없는 문제는 보고하지 않는다. 그것은 다른 담당의 일이다.
- 확신이 없으면 `pass` 로 판정한다. 위치를 댈 수 없는 위반은 위반이 아니다.
- `symbol` 은 위반이 속한 가장 가까운 함수, 메서드, 클래스, 최상위 선언의 이름을 코드에 적힌 그대로 쓴다. 메서드는 `클래스명.메서드명` 으로 쓴다. 어디에도 속하지 않으면 `<module>` 로 쓴다.
- 기존 지적 목록에 같은 규칙, 같은 위치의 지적이 있으면 `matches` 에 그 `id` 를 적는다. 심볼 이름 표기가 조금 달라도 같은 코드를 가리키면 같은 지적이다. 없으면 `null`.
- 코드를 고치지 않는다. 고치는 방법을 제안하지 않는다.
- `.review/` 아래의 파일은 읽지도 쓰지도 않는다.

## 반환

JSON 배열 하나만 반환한다. 앞뒤에 설명을 붙이지 않는다.

```json
[
  {
    "ruleId": "R-001",
    "file": "src/db/user.ts",
    "symbol": "findUserByName",
    "verdict": "violation",
    "evidence": "src/db/user.ts:42",
    "title": "name 파라미터가 검증 없이 쿼리 문자열에 들어감",
    "matches": null
  },
  {
    "ruleId": "R-002",
    "file": "src/db/user.ts",
    "symbol": "<module>",
    "verdict": "n/a",
    "evidence": "",
    "title": "",
    "matches": null
  }
]
```

`pass` 와 `n/a` 항목의 `symbol` 은 `<module>`, `evidence` 와 `title` 은 빈 문자열로 둔다. `title` 은 무엇이 문제인지를 한 문장으로 쓴다.
````

- [ ] **Step 4: explorer 쓰기**

`anetos-review/agents/explorer.md`:

````markdown
---
name: explorer
description: 규칙 목록이 다루지 않는 버그·보안·데이터 손실·동시성 문제의 후보를 찾는다. anetos-review 의 review 스킬이 호출한다.
tools: Read, Grep, Glob
---

당신은 코드 리뷰의 자유 탐색 담당이다. 규칙 검사가 놓치는 문제의 후보를 찾는다. 당신이 낸 후보는 다른 담당이 따로 검증하므로, 당신의 일은 근거 있는 후보를 내는 것이다.

## 받는 것

- 파일 목록: 살펴볼 파일의 경로
- 규칙 목록: 이미 규칙 검사가 다루는 규칙의 ID 와 제목
- 기존 지적 목록: 이 파일들에 이미 등록된 지적의 `id`, `source`, `symbol`, `title`, `status`

## 하는 일

1. 받은 파일을 전부 읽는다. 동작을 이해하는 데 필요하면 관련 파일도 읽는다.
2. 다음 네 분류에 드는 문제만 찾는다.
   - `bug`: 코드가 명백히 의도와 다르게 동작한다. 잘못된 계산, 잘못된 조건, 잘못된 단위.
   - `security`: 공격자가 이용할 수 있는 결함.
   - `data-loss`: 데이터가 사라지거나 손상될 수 있다.
   - `concurrency`: 실행 순서에 따라 결과가 달라진다.
3. 후보마다 어떤 입력이나 상황에서 무엇이 잘못되는지를 `claim` 에 구체적으로 쓴다.

## 지켜야 할 것

- 규칙 목록의 규칙이 다루는 문제는 내지 않는다. 그것은 규칙 검사가 맡는다.
- 스타일, 이름 짓기, 구조, 가독성, 성능 개선, 테스트 부족은 내지 않는다.
- "~일 수 있다" 수준의 추측은 내지 않는다. 잘못되는 입력이나 상황을 댈 수 없으면 후보가 아니다.
- 기존 지적 목록에 같은 문제가 있으면 `matches` 에 그 `id` 를 적는다. `status` 가 `dismissed`, `intended`, `rejected` 인 지적과 같은 문제도 빼지 말고 `matches` 를 적어서 낸다. 걸러내는 것은 호출한 쪽이 한다.
- `symbol` 은 문제가 속한 가장 가까운 함수, 메서드, 클래스, 최상위 선언의 이름을 코드에 적힌 그대로 쓴다. 메서드는 `클래스명.메서드명`, 어디에도 속하지 않으면 `<module>`.
- 후보가 없으면 빈 배열을 반환한다. 후보를 채우려고 약한 것을 넣지 않는다.
- 코드를 고치지 않는다. `.review/` 아래의 파일은 읽지도 쓰지도 않는다.

## 반환

JSON 배열 하나만 반환한다. 앞뒤에 설명을 붙이지 않는다.

```json
[
  {
    "category": "bug",
    "file": "src/cart.js",
    "symbol": "totalPrice",
    "claim": "discount 가 퍼센트 값(예: 20)인데 10으로 나누어, 20% 할인이 200% 할인으로 계산되어 합계가 음수가 된다",
    "evidence": "src/cart.js:14",
    "matches": null
  }
]
```
````

- [ ] **Step 5: verifier 쓰기**

`anetos-review/agents/verifier.md`:

````markdown
---
name: verifier
description: 문제 주장 하나를 코드에 비추어 독립적으로 검증하거나, 기존 지적이 아직 남아 있는지 확인한다. anetos-review 의 review 스킬이 호출한다.
tools: Read, Grep, Glob
---

당신은 코드 리뷰의 검증 담당이다. 주장 하나를 받아 코드만 보고 참인지 판정한다. 주장을 낸 쪽의 추론은 받지 않으며, 받지 않는 것이 맞다. 당신의 판정은 주장과 독립이어야 한다.

요청에는 `mode` 가 있다. 모드에 따라 하는 일이 다르다.

## mode: candidate (후보 검증)

받는 것: `file`, `symbol`, `claim`, `evidence`

1. 해당 파일과 심볼을 읽는다. 호출하는 쪽과 호출되는 쪽도 필요한 만큼 읽는다.
2. 주장이 말하는 문제가 실제로 일어나는 구체적인 시나리오를 만들어 본다. 어떤 입력이 들어오고, 코드가 어떤 줄을 지나, 무엇이 잘못되는지를 단계로 댈 수 있어야 한다.
3. 판정한다.
   - `confirmed`: 시나리오를 처음부터 끝까지 코드로 따라갈 수 있다.
   - `unconfirmed`: 시나리오를 만들 수 없거나, 다른 곳의 코드가 그 상황을 막고 있거나, 주장이 코드와 맞지 않는다.

확신이 없으면 `unconfirmed` 다. 주장이 그럴듯하다는 것은 근거가 아니다.

반환:

```json
{
  "verdict": "confirmed",
  "scenario": "discount=20 으로 호출하면 14행에서 subtotal * 20 / 10 = subtotal * 2 를 빼서 합계가 -subtotal 이 된다",
  "evidence": "src/cart.js:14"
}
```

`unconfirmed` 일 때 `scenario` 에는 왜 확인되지 않았는지를 쓴다.

## mode: recheck (기존 지적 재확인)

받는 것: `id`, `source`, `file`, `symbol`, `title`, `evidence`, 그리고 `source` 가 규칙이면 그 규칙의 설명

1. 해당 파일과 심볼을 읽는다. 파일이나 심볼이 없어졌으면 `absent` 다.
2. `title` 이 말하는 문제가 현재 코드에 그대로 있는지만 본다. 다른 문제를 찾지 않는다.
3. 판정한다.
   - `present`: 같은 문제가 아직 있다. 현재 위치를 `evidence` 에 `파일:줄` 로 쓴다.
   - `absent`: 그 문제가 더 이상 없다. `evidence` 는 빈 문자열.

반환:

```json
{ "verdict": "present", "evidence": "src/db/user.ts:45" }
```

## 공통

- JSON 객체 하나만 반환한다. 앞뒤에 설명을 붙이지 않는다.
- 받은 주장이나 지적 하나만 다룬다. 새 문제를 보고하지 않는다.
- 코드를 고치지 않는다. `.review/` 아래의 파일은 읽지도 쓰지도 않는다.
````

- [ ] **Step 6: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: PASS. 32개 통과, 0개 실패.

- [ ] **Step 7: 커밋**

```bash
git add anetos-review/agents anetos-review/scripts
git commit -m "feat: rule-checker, explorer, verifier 에이전트 추가"
```

---

### Task 7: review와 review-decide 스킬

**Files:**
- Create: `anetos-review/skills/review/SKILL.md`
- Create: `anetos-review/skills/review-decide/SKILL.md`
- Modify: `anetos-review/scripts/ledger.test.mjs` (끝에 추가)

**Interfaces:**
- Consumes:
  - Task 4의 CLI 전부
  - Task 3의 `results` 형식
  - Task 6의 에이전트 이름과 반환 형식
- Produces: `/anetos-review:review [경로]`, `/anetos-review:review-decide <id> <결정> "이유"`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`ledger.test.mjs` 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: FAIL. `ENOENT ... skills/review/SKILL.md`.

- [ ] **Step 3: review 스킬 쓰기**

`anetos-review/skills/review/SKILL.md`:

````markdown
---
name: review
description: 고정 규칙 검사와 검증된 자유 탐색으로 코드를 리뷰하고 결과를 대상 저장소의 .review/ 원장에 기록한다. 사용자가 anetos-review 로 코드 리뷰를 요청하거나 /anetos-review:review 를 실행할 때 사용한다.
---

# 코드 리뷰

이 스킬은 리뷰만 한다. 코드를 고치지 않고, 고치는 방법도 제안하지 않는다.

판단은 서브에이전트가 하고, 당신은 결과를 모아 원장에 넘긴다. 원장은 아래의 `ledger.mjs` 명령으로만 다룬다. `.review/findings.json` 과 `.review/decisions.md` 를 직접 편집하지 않는다.

모든 명령은 대상 저장소의 루트에서 실행한다. 원장 스크립트는 다음과 같이 부른다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" <명령>
```

## 1. 범위 확정

- 인자로 경로를 받았으면 그 경로 아래의 소스 파일이 범위다.
- 인자가 없으면 기준 브랜치 대비 변경된 파일이 범위다. 기준 브랜치는 `main`, 없으면 `master` 다.

  ```bash
  git diff --name-only --diff-filter=d main...HEAD
  git diff --name-only --diff-filter=d
  ```

  두 결과를 합친다. 커밋된 변경과 아직 커밋하지 않은 변경을 모두 본다.
- git 저장소가 아니거나 기준 브랜치가 없으면 추측하지 말고, 경로를 인자로 달라고 사용자에게 말한 뒤 멈춘다.
- `.review/` 아래의 파일, 삭제된 파일, 바이너리, 잠금 파일, 생성된 파일(`dist/`, `build/`, `node_modules/`)은 범위에서 뺀다.
- 범위가 비면 "리뷰할 변경이 없습니다" 라고 말하고 멈춘다.

커밋 해시를 구해 둔다. 실패하면 `uncommitted` 를 쓴다.

```bash
git rev-parse --short HEAD
```

## 2. 불러오기

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" init
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" list --files <범위 파일을 쉼표로 이은 것>
```

- `init` 은 `.review/` 가 없을 때만 만든다. 새로 만들었으면 사용자에게 `.review/rules.md` 가 생겼고 프로젝트에 맞게 고칠 수 있다고 한 줄로 알린다.
- `.review/rules.md` 를 읽는다. `- 상태: 폐기` 가 붙은 규칙은 뺀다.
- `list` 의 결과가 이 범위의 **기존 지적**이다.

## 3. 기존 지적 재확인

기존 지적 중 `status` 가 `open` 인 것마다 `anetos-review:verifier` 를 하나씩, 한 번에 병렬로 띄운다. 넘기는 내용:

```
mode: recheck
id, source, file, symbol, title, evidence
(source 가 R-로 시작하면) 그 규칙의 설명
```

각 반환 `{ verdict, evidence }` 를 `rechecks` 에 `{ id, verdict, evidence }` 로 모은다.

## 4. 규칙 검사

규칙마다 `- 적용:` glob 에 맞는 범위 파일을 고른다. 맞는 파일이 없는 규칙은 건너뛴다.

- 범위 파일이 10개 이하이면 `anetos-review:rule-checker` 하나를 띄운다.
- 10개를 넘으면 디렉터리가 같은 파일끼리 묶어 10개 이하의 묶음으로 나누고, 묶음마다 하나씩 병렬로 띄운다.

넘기는 내용: 적용되는 규칙의 ID·제목·설명·위반 예, 담당 파일 목록, 담당 파일의 기존 지적 목록(`id`, `source`, `symbol`, `title`).

반환에서 `verdict` 가 `violation` 인 항목만 `violations` 에 넣는다. `ruleId` 를 `source` 로 옮긴다.

```json
{ "source": "R-001", "file": "...", "symbol": "...", "title": "...", "evidence": "...", "matches": null }
```

## 5. 자유 탐색

`anetos-review:explorer` 를 **하나만** 띄운다. 범위가 커도 나누지 않는다.

넘기는 내용: 범위 파일 목록, 규칙의 ID 와 제목 목록, 범위의 기존 지적 목록(`id`, `source`, `symbol`, `title`, `status`).

## 6. 후보 검증

explorer 가 낸 후보마다 먼저 ID 를 정한다. `matches` 가 있으면 그 값이고, 없으면 다음으로 계산한다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" id "explore:<category>" "<file>" "<symbol>"
```

그 ID 가 기존 지적에 있고 `status` 가 `dismissed` 이면 그 후보는 버린다. 검증하지 않고 `candidates` 에도 넣지 않는다.

남은 후보마다 `anetos-review:verifier` 를 하나씩 병렬로 띄운다. 넘기는 내용은 다음뿐이다.

```
mode: candidate
file, symbol, claim, evidence
```

explorer 가 쓴 다른 설명이나 당신의 의견을 덧붙이지 않는다. 검증은 주장과 코드만으로 이루어져야 한다.

각 후보와 반환을 합쳐 `candidates` 에 넣는다. `claim` 을 `title` 로 옮긴다.

```json
{ "category": "bug", "file": "...", "symbol": "...", "title": "<claim>", "evidence": "...", "matches": null, "verdict": "confirmed" }
```

## 7. 원장 갱신

모은 결과를 `.review/results.tmp` 에 쓴다.

```json
{
  "commit": "<1단계의 커밋 해시>",
  "rechecks": [],
  "violations": [],
  "candidates": []
}
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" apply .review/results.tmp
```

- 성공하면 `.review/results.tmp` 를 지운다.
- 형식 오류로 실패하면 오류 메시지가 가리키는 항목을 에이전트의 원래 반환과 대조해 옮겨 적다 생긴 실수를 고치고 한 번 다시 실행한다. 에이전트의 반환 자체가 틀렸으면 그 항목을 빼고, 무엇을 왜 뺐는지 보고에 적는다. 판정 내용을 지어내서 채우지 않는다.

지적을 기존 것과 같은 것으로 볼지, 결정과 충돌하는지, 재발인지는 `apply` 가 판정한다. 당신이 따로 판정하지 않는다.

## 8. 보고

`apply` 가 돌려준 요약의 ID 로 지적을 조회해 다섯 묶음으로 보여 준다. 비어 있는 묶음은 생략한다.

1. **신규** (`new`)
2. **여전히 열려 있음** (`stillOpen`)
3. **해결됨** (`resolved`)
4. **재발** (`recurred`): 해결됐던 지적이 다시 나타났다.
5. **재검토 요청** (`reopenRequested`): 이전에 "의도된 설계" 또는 "기각"으로 결정한 것과 충돌한다.

각 항목은 `ID · 파일:줄 · 심볼 · 제목` 으로 쓴다. `dismissed` 는 개수만 한 줄로 알린다.

재검토 요청 항목에는 `.review/decisions.md` 에서 해당 결정의 이유를 찾아 함께 보여 주고, 코드를 바꾸라고 권하지 않는다. 사용자가 다음 중 하나로 정한다고 안내한다.

```
/anetos-review:review-decide <ID> reopen "이유"    결정을 뒤집고 다시 연다
/anetos-review:review-decide <ID> keep "이유"      기존 결정을 유지한다
```

신규와 열린 지적이 사실은 의도된 것이거나 틀린 지적이면 다음으로 기록할 수 있다고 안내한다.

```
/anetos-review:review-decide <ID> intended "이유"
/anetos-review:review-decide <ID> rejected "이유"
```

마지막에 `.review/` 의 변경을 코드와 함께 커밋하라고 한 줄로 알린다. 직접 커밋하지 않는다.
````

- [ ] **Step 4: review-decide 스킬 쓰기**

`anetos-review/skills/review-decide/SKILL.md`:

````markdown
---
name: review-decide
description: anetos-review 의 지적 하나에 대한 사람의 결정(의도된 설계, 기각, 재검토 승인, 기존 결정 유지)을 이유와 함께 기록한다.
disable-model-invocation: true
argument-hint: <지적 ID> <intended|rejected|reopen|keep> "이유"
---

# 리뷰 결정 기록

이 스킬은 사용자가 내린 결정을 기록한다. 결정과 이유는 사용자의 것이다. 당신이 대신 정하거나 이유를 지어내지 않는다.

인자: `$ARGUMENTS`

## 절차

1. 인자에서 지적 ID, 결정, 이유를 읽는다.
   - 결정은 `intended`(의도된 설계), `rejected`(지적이 틀림), `reopen`(재검토 승인), `keep`(기존 결정 유지) 중 하나다.
   - 셋 중 하나라도 없으면 무엇이 빠졌는지 말하고 멈춘다. 이유가 없을 때 그럴듯한 이유를 만들어 넣지 않는다.
2. 대상 저장소의 루트에서 실행한다. 이유는 사용자가 쓴 그대로 넘긴다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" decide <ID> <결정> --reason "<이유>"
   ```

3. 성공하면 결정 번호와 바뀐 상태를 한 줄로 알린다.
4. 실패하면 스크립트의 오류 메시지를 그대로 전한다. 다른 결정으로 바꿔 다시 시도하지 않는다.

`.review/findings.json` 과 `.review/decisions.md` 를 직접 편집하지 않는다.
````

- [ ] **Step 5: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/`
Expected: PASS. 33개 통과, 0개 실패.

- [ ] **Step 6: 플러그인이 로드되고 스크립트 경로가 풀리는지 확인**

`${CLAUDE_PLUGIN_ROOT}` 가 스킬 본문 안에서 실제 경로로 바뀌는지는 이 계획을 쓰는 시점에 확인하지 못했다. 여기서 확인한다.

빈 임시 폴더를 만들어 그 안에서 플러그인을 붙여 Claude Code를 실행한다.

```bash
mkdir -p /c/tmp/anetos-smoke && cd /c/tmp/anetos-smoke && git init
claude --plugin-dir /c/dev/anetos/anetos-review
```

세션 안에서 `/anetos-review:review .` 를 실행한다.

Expected:
- 스킬 목록에 `anetos-review:review` 와 `anetos-review:review-decide` 가 보인다.
- `ledger.mjs init` 이 성공해 `/c/tmp/anetos-smoke/.review/` 에 `rules.md`, `findings.json`, `decisions.md`, `.gitignore` 가 생긴다.
- 소스 파일이 없으므로 "리뷰할 변경이 없습니다" 로 끝난다.

`node` 가 `${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs` 를 찾지 못한다는 오류가 나면 변수가 치환되지 않은 것이다. 그 경우 두 스킬의 모든 `${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs` 를 `${CLAUDE_SKILL_DIR}/../../scripts/ledger.mjs` 로 바꾸고 이 Step을 다시 실행한다. Step 1의 테스트는 `ledger.mjs" <명령>` 부분만 보므로 고칠 필요가 없다. 둘 다 치환되지 않으면 멈추고 사용자에게 보고한다.

- [ ] **Step 7: 커밋**

```bash
git add anetos-review/skills anetos-review/scripts
git commit -m "feat: review 와 review-decide 스킬 추가"
```

---

### Task 8: fixture와 수렴 측정

**Files:**
- Create: `anetos-review/fixtures/sample-repo/src/users.js`
- Create: `anetos-review/fixtures/sample-repo/src/files.js`
- Create: `anetos-review/fixtures/sample-repo/src/rates.js`
- Create: `anetos-review/fixtures/sample-repo/src/cart.js`
- Create: `anetos-review/fixtures/EXPECTED.md`

**Interfaces:**
- Consumes: Task 7의 `/anetos-review:review`, `/anetos-review:review-decide`
- Produces: 스펙 8절의 측정 결과 (`EXPECTED.md` 의 결과 표)

fixture 코드에는 심은 문제를 알려 주는 주석을 달지 않는다. 리뷰 에이전트가 주석을 읽고 답을 맞히면 측정이 무의미해진다. 같은 이유로 문제 목록은 `sample-repo/` 밖의 `EXPECTED.md` 에 둔다.

- [ ] **Step 1: fixture 코드 쓰기**

`anetos-review/fixtures/sample-repo/src/users.js`:

```js
const db = require('./db');

const ANALYTICS_KEY = 'acme_live_9f2c81d7a4b34e0fa6c5d1e2b7384a90';

async function findUserByName(name) {
  const rows = await db.query("SELECT * FROM users WHERE name = '" + name + "'");
  return rows[0] ?? null;
}

async function loadProfile(userId) {
  try {
    const rows = await db.query('SELECT * FROM profiles WHERE user_id = ?', [userId]);
    return rows[0] ?? null;
  } catch (err) {
    return null;
  }
}

function analyticsHeaders() {
  return { Authorization: `Bearer ${ANALYTICS_KEY}` };
}

module.exports = { findUserByName, loadProfile, analyticsHeaders };
```

`anetos-review/fixtures/sample-repo/src/files.js`:

```js
const fs = require('fs');

function readHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(16);
  const bytes = fs.readSync(fd, buffer, 0, 16, 0);
  if (bytes < 16) {
    throw new Error('header too short');
  }
  fs.closeSync(fd);
  return buffer;
}

module.exports = { readHeader };
```

`anetos-review/fixtures/sample-repo/src/rates.js`:

```js
async function fetchRates(baseCurrency) {
  const url = 'https://rates.example.com/latest?base=' + encodeURIComponent(baseCurrency);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('rates request failed: ' + response.status);
  }
  return response.json();
}

module.exports = { fetchRates };
```

`anetos-review/fixtures/sample-repo/src/cart.js`:

```js
function totalPrice(items, discountPercent) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return subtotal - (subtotal * discountPercent) / 10;
}

function sortByPrice(items) {
  return [...items].sort((a, b) => a.price > b.price);
}

function isExpired(coupon) {
  return Date.now() > coupon.expiresAtSeconds;
}

module.exports = { totalPrice, sortByPrice, isExpired };
```

- [ ] **Step 2: 기대 목록과 측정 절차 쓰기**

`anetos-review/fixtures/EXPECTED.md`:

```markdown
# fixture 에 심은 문제와 수렴 측정

`sample-repo/` 의 코드에는 문제를 알려 주는 주석이 없다. 이 파일을 `sample-repo/` 안으로 옮기지 않는다.

## 심은 문제

### 규칙 위반 5건

| 규칙 | 파일 | 심볼 | 내용 |
|---|---|---|---|
| R-001 | src/users.js | findUserByName | name 을 문자열 연결로 SQL 에 넣음 |
| R-002 | src/users.js | `<module>` | ANALYTICS_KEY 에 실제 형태의 키가 상수로 들어 있음 |
| R-003 | src/users.js | loadProfile | catch 가 오류를 버리고 null 을 돌려줌 |
| R-005 | src/files.js | readHeader | 헤더가 짧아 예외를 던질 때 fd 를 닫지 않음 |
| R-007 | src/rates.js | fetchRates | fetch 에 제한 시간이 없음 |

### 규칙 밖 버그 3건

| 파일 | 심볼 | 내용 |
|---|---|---|
| src/cart.js | totalPrice | 퍼센트 할인을 100 이 아니라 10 으로 나눔 |
| src/cart.js | sortByPrice | 비교 함수가 숫자가 아니라 불리언을 돌려줘 정렬되지 않음 |
| src/cart.js | isExpired | 밀리초(Date.now)를 초 단위 값과 비교함 |

## 측정 절차

1. `sample-repo/` 를 플러그인 저장소 밖의 빈 폴더로 복사하고 git 저장소로 만든다.

   ```bash
   rm -rf /c/tmp/anetos-fixture && cp -r /c/dev/anetos/anetos-review/fixtures/sample-repo /c/tmp/anetos-fixture
   cd /c/tmp/anetos-fixture && git init && git add . && git commit -m "fixture"
   ```

2. 플러그인을 붙여 Claude Code 를 실행한다.

   ```bash
   claude --plugin-dir /c/dev/anetos/anetos-review
   ```

3. 1회차: `/anetos-review:review src` 를 실행한다. 끝나면 `.review/findings.json` 을 `run1.json` 으로 복사해 둔다.
4. 1회차에서 잡힌 R-007 지적의 ID 로 결정을 기록한다.

   ```
   /anetos-review:review-decide <R-007 지적의 ID> intended "측정용: 이 호출은 제한 시간 없이 둔다"
   ```

5. 2회차와 3회차: 코드를 바꾸지 않고, 회차마다 **새 세션**에서 `/anetos-review:review src` 를 실행한다. 같은 세션에서 이어 돌리면 이전 회차의 대화가 남아 결과가 실제보다 좋게 나온다. 끝날 때마다 `findings.json` 을 `run2.json`, `run3.json` 으로 복사한다.
6. 아래 표를 채운다.

## 지표와 목표

| 지표 | 세는 방법 | 초기 목표 |
|---|---|---|
| 1회차에 잡힌 규칙 위반 | run1.json 에서 위 5건에 해당하는 open 지적 수 | 5건 중 5건 |
| 중복 등록 | run2·run3 에서, 이미 있는 문제와 같은 문제인데 ID 가 다른 지적 수 | 0건 |
| 회차당 신규 | run2, run3 각각에서 새로 생긴 open 지적 수 | 각 2건 이하 |
| 결정 번복 | R-007 지적이 2·3회차 보고의 "신규"나 "여전히 열려 있음"에 다시 나온 횟수 | 0건 |

참고로 함께 적는다(목표 없음): 1회차에 잡힌 규칙 밖 버그 수(3건 중), 회차별 dismissed 수.

## 결과

| 날짜 | 모델 | 1회차 규칙 위반 | 중복 등록 | 2회차 신규 | 3회차 신규 | 결정 번복 | 규칙 밖 버그 | 비고 |
|---|---|---|---|---|---|---|---|---|
```

- [ ] **Step 3: 측정 실행**

`EXPECTED.md` 의 측정 절차 1~6을 그대로 수행하고 결과 표에 한 줄을 채운다.

R-007 지적이 2·3회차에 `재검토 요청` 묶음에 나오는 것은 정상이며 번복으로 세지 않는다. 설계상 결정과 충돌하는 지적은 그 묶음으로 가야 한다. 이때 `keep` 으로 결정을 유지하고 다음 회차로 넘어간다.

```
/anetos-review:review-decide <R-007 지적의 ID> keep "측정용: 결정 유지"
```

- [ ] **Step 4: 목표에 못 미치면 원인을 찾아 고친다**

목표를 모두 채웠으면 Step 5로 간다. 못 채웠으면 지표별로 다음을 먼저 본다.

| 미달 지표 | 먼저 볼 곳 |
|---|---|
| 1회차 규칙 위반 누락 | 누락된 규칙의 설명과 위반 예(`rules/default.md`). rule-checker 가 `pass` 로 판정했는지 `n/a` 로 판정했는지 반환을 확인한다 |
| 중복 등록 | 중복된 두 지적의 `symbol` 을 비교한다. 표기가 달라서 생긴 것이면 에이전트 문서의 `symbol` 규칙과 `matches` 지시를 고친다 |
| 회차당 신규 초과 | 신규 지적의 `source` 를 본다. `explore:` 이면 explorer 의 제한을, `R-` 이면 1회차에 그 규칙이 왜 빠졌는지를 본다 |
| 결정 번복 | `apply` 에 들어간 `results.tmp` 의 해당 항목과 ID 를 본다. ID 가 달라졌으면 중복 등록과 같은 원인이다 |

고친 뒤 `/c/tmp/anetos-fixture` 를 지우고 측정 절차를 처음부터 다시 수행해 결과 표에 줄을 추가한다. 이전 줄은 지우지 않는다.

에이전트·스킬 문서를 두 번 고쳐도 같은 지표가 미달이면 더 고치지 말고 멈춘다. 결과 표와 함께 무엇을 시도했는지를 사용자에게 보고하고, 목표값이나 설계를 바꿀지 묻는다. 목표를 맞추려고 fixture 를 쉽게 바꾸거나 `EXPECTED.md` 의 세는 방법을 바꾸지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/fixtures anetos-review/agents anetos-review/skills anetos-review/rules
git commit -m "test: fixture 저장소와 수렴 측정 결과 추가"
```

---

## 완료 기준

- `node --test anetos-review/scripts/` 가 33개 통과, 0개 실패로 끝난다.
- `claude --plugin-dir C:\dev\anetos\anetos-review` 로 실행한 세션에서 `/anetos-review:review` 와 `/anetos-review:review-decide` 가 동작한다.
- `anetos-review/fixtures/EXPECTED.md` 의 결과 표에 측정 결과가 한 줄 이상 있고, 네 지표의 달성 여부가 적혀 있다. 미달인 지표가 있으면 사용자에게 보고되어 있다.
