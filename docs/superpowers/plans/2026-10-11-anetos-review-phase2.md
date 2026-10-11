# anetos-review 2차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원장의 지적 하나를 기준선 → 빨강 → 초록 세 단계로 고치고, 회귀가 없을 때만 커밋하는 `review-fix`를 `anetos-review`에 추가한다.

**Architecture:** 검사 실행, 단계별 통과 판정, 범위 분류, 되돌리기, 커밋은 새 스크립트 `fix.mjs`가 한다. 판정은 종료 코드와 git 상태로만 하고 LLM은 관여하지 않는다. 테스트와 수정을 쓰는 일은 명령 실행 도구가 없는 `fixer` 에이전트가 하고, `review-fix` 스킬이 순서를 진행한다. 원장 상태는 계속 `ledger.mjs`가 맡는다.

**Tech Stack:** Node.js 20 이상(내장 `node:test`, `node:child_process`, `node:fs`), git, Claude Code 플러그인(skills, agents). 외부 패키지 없음.

**Spec:** `docs/superpowers/specs/2026-10-11-anetos-review-phase2-design.md` (선행: `2026-10-11-anetos-review-phase1-design.md`)

## Global Constraints

- 새 파일은 전부 `C:\dev\anetos\anetos-review\` 아래에 둔다.
- `fix.mjs`는 외부 의존성이 없어야 한다. `package.json`을 만들지 않는다.
- 검사의 통과·실패는 종료 코드로만 판정한다. 종료 코드 0이 `pass`, 그 외와 제한 시간 초과는 `fail`이다.
- 검사 결과는 항상 기준선과 비교한다. 판정은 `kept`, `regressed`, `masked`, `improved`, `flaky` 다섯 가지다.
- 검증 수준은 `reproduced`, `guarded`, `unverified` 세 가지다. `unverified`와 범위 밖 파일은 승인 플래그 없이는 커밋되지 않는다.
- `.review/findings.json`은 `ledger.mjs`의 `loadLedger`/`saveLedger`로만 읽고 쓴다. 원장의 `version`은 1 그대로 둔다.
- `abort`는 `.review/` 아래의 파일과 수정 시작 전부터 있던 미추적 파일을 건드리지 않는다.
- 상태를 추가하지 않는다. 고쳐서 해결된 지적도 `resolved`이고, `fixLevel` 필드로 구분한다.
- `review-config`와 `review-fix` 스킬은 `disable-model-invocation: true`다.
- `fixer` 에이전트의 도구는 `Read, Grep, Glob, Edit, Write`뿐이다. 명령 실행 도구를 주지 않는다.
- 지적이 없어질 때까지 리뷰와 수정을 자동으로 반복하는 동작을 넣지 않는다.
- 커밋 메시지는 `fix(review): <지적 제목> [<지적 ID>]`다.
- 사용자에게 보이는 문구는 한국어로 쓴다.
- 테스트 실행은 파일 경로를 직접 준다. `node --test <디렉터리>`는 Node 22에서 실패한다.

## Review Focus

스펙이 직접 말하지 않지만 실제 사용에서 걸릴 가능성이 높은 다섯 가지다. 각각 해당 Task에 테스트를 넣었다.

1. **검사가 저장소 안에 파일을 만든다** (`coverage/`, 캐시 등): 검사가 만든 파일이 "수정이 만든 범위 밖 파일"로 보고되거나 `abort`에서 지워지면 안 된다. 기준선을 실행한 뒤의 미추적 파일을 "원래 있던 것"으로 기록한다. (Task 3)
2. **리뷰만 하고 커밋하지 않은 `.review/`**: `/review` 직후 `.review/`를 커밋하지 않은 채 `review-fix`를 실행하는 것이 흔한 흐름이다. 시작을 막지 않아야 하고, `abort`가 그 변경을 지우면 안 된다. (Task 3)
3. **공백과 한글이 든 파일 이름**: `test/새 파일.test.js` 같은 경로가 범위 분류와 되돌리기에서 깨지지 않아야 한다. (Task 3)
4. **출력이 큰 검사**: 통과한 검사가 출력이 많다는 이유로 실패로 판정되면 안 된다. (Task 2)
5. **따옴표와 줄바꿈이 든 지적 제목**: 커밋 메시지가 깨지거나 셸이 해석하면 안 된다. 한 줄로 합쳐 그대로 들어가야 한다. (Task 5)

---

## File Structure

| 파일 | 책임 |
|---|---|
| `anetos-review/scripts/fix.mjs` | 신규. 설정, 검사 실행과 비교, 수정 상태 파일, 단계 판정, 마무리, 중단, CLI |
| `anetos-review/scripts/fix.test.mjs` | 신규. 임시 git 저장소에서 실제로 실행하는 테스트 |
| `anetos-review/scripts/ledger.mjs` | 수정. 재발 시 `fixLevel`을 지운다(한 줄) |
| `anetos-review/scripts/ledger.test.mjs` | 수정. 위 동작의 테스트 하나 |
| `anetos-review/agents/fixer.md` | 신규. 테스트와 수정을 쓰는 에이전트 |
| `anetos-review/agents/rule-checker.md`, `explorer.md` | 수정. "고쳐진 지적" 지침 추가 |
| `anetos-review/skills/review-config/SKILL.md` | 신규. 검증 명령을 정해 저장 |
| `anetos-review/skills/review-fix/SKILL.md` | 신규. 수정 절차 |
| `anetos-review/skills/review/SKILL.md` | 수정. 고쳐진 지적을 에이전트에게 넘긴다 |
| `anetos-review/fixtures/sample-repo/` | 수정. 테스트와 함정 추가 |
| `anetos-review/fixtures/EXPECTED.md` | 수정. 2차 측정 절차와 결과 |

`fix.mjs`는 한 파일로 둔다. 400줄 안팎이고 함수들이 상태 파일 하나를 공유한다.

테스트 실행 명령 (`C:\dev\anetos`에서):

```bash
node --test anetos-review/scripts/fix.test.mjs
node --test anetos-review/scripts/ledger.test.mjs
```

`fix.test.mjs`는 테스트마다 git 저장소를 만들고 node 프로세스를 여러 번 띄우므로 전체 실행에 1분 가까이 걸릴 수 있다.

---

### Task 1: 설정과 경로 glob

**Files:**
- Create: `anetos-review/scripts/fix.mjs`
- Create: `anetos-review/scripts/fix.test.mjs`

**Interfaces:**
- Consumes (`ledger.mjs`): `DIR`, `LedgerError`, `init(root, pluginRoot)`, `loadLedger`, `saveLedger`, `findingId`, `fileHash(root, file)`
- Produces:
  - `validateConfig(cfg): string[]` — 오류 메시지 배열. 비어 있으면 올바른 설정
  - `loadConfig(root): Config` — 없거나 틀리면 `LedgerError`
  - `saveConfig(root, cfg): Config` — 검증 후 `.review/config.json`에 저장. 틀리면 쓰지 않고 `LedgerError`
  - `globToRegExp(glob: string): RegExp` — `**`, `*`, `?` 지원
  - `isTestPath(cfg, file: string): boolean`
  - `Config`: `{ version: 1, checks: [{ name, kind: 'test'|'static', command, timeoutSec? }], testPaths: string[] }`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`anetos-review/scripts/fix.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LedgerError, findingId, init, loadLedger, saveLedger } from './ledger.mjs';
import { validateConfig, loadConfig, saveConfig, globToRegExp, isTestPath } from './fix.mjs';

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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: FAIL. `Cannot find module ... fix.mjs`.

- [ ] **Step 3: 구현 쓰기**

`anetos-review/scripts/fix.mjs`:

```js
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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
```

`spawnSync`, `fileURLToPath`, `fileHash`, `loadLedger`, `saveLedger`는 뒤 Task에서 쓴다. 지금은 import만 해 둔다.

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: PASS. 5개 통과, 0개 실패.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/scripts/fix.mjs anetos-review/scripts/fix.test.mjs
git commit -m "feat: 검증 설정과 테스트 경로 glob 추가"
```

---

### Task 2: 검사 실행과 기준선 비교

**Files:**
- Modify: `anetos-review/scripts/fix.mjs` (끝에 추가)
- Modify: `anetos-review/scripts/fix.test.mjs` (끝에 추가, import 줄 수정)

**Interfaces:**
- Consumes: `Config`
- Produces:
  - `runCheck(root, check): CheckResult` — `{ name, kind, result: 'pass'|'fail', timedOut: boolean, tail: string }`. `tail`은 출력의 마지막 40줄
  - `runChecks(root, cfg): CheckResult[]`
  - `compare(baseline: CheckResult[], current: CheckResult[]): Verdict[]` — `{ name, kind, verdict: 'kept'|'regressed'|'masked'|'improved', tail }`. `tail`은 현재 실행의 것
  - 테스트 도우미(Task 3~5가 재사용): `helper(name, code): string` — 임시 폴더에 스크립트를 쓰고 `node "<경로>"` 명령 문자열을 돌려준다. `PASS`, `FAIL` 명령 상수

- [ ] **Step 1: 실패하는 테스트 쓰기**

import 줄을 다음으로 바꾼다.

```js
import {
  validateConfig, loadConfig, saveConfig, globToRegExp, isTestPath, runCheck, compare,
} from './fix.mjs';
```

파일 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: FAIL. `runCheck`를 export하지 않는다는 SyntaxError.

- [ ] **Step 3: 구현 추가**

`fix.mjs` 끝에 추가한다.

```js
const TAIL_LINES = 40;
const DEFAULT_TIMEOUT_SEC = 600;

export function runCheck(root, check) {
  const r = spawnSync(check.command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: (check.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    name: check.name,
    kind: check.kind,
    result: r.status === 0 && !r.error ? 'pass' : 'fail',
    timedOut: r.error?.code === 'ETIMEDOUT',
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
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: PASS. 10개 통과, 0개 실패.

제한 시간 테스트가 실패하면(`result`가 `pass`로 나오면) Windows에서 셸만 종료되고 자식 프로세스가 끝까지 실행된 것이다. 그 경우 테스트를 고치지 말고 `runCheck`가 `r.error`가 있을 때 항상 `fail`을 돌려주는지부터 확인한다. `r.error`가 설정되지 않는 것이 원인이면 멈추고 보고한다. 제한 시간이 동작하지 않는 채로 넘어가면 멈춘 테스트가 `review-fix`를 무한정 붙잡는다.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/scripts
git commit -m "feat: 검사 실행과 기준선 비교 추가"
```

---

### Task 3: 수정 시작과 중단

**Files:**
- Modify: `anetos-review/scripts/fix.mjs` (끝에 추가)
- Modify: `anetos-review/scripts/fix.test.mjs` (끝에 추가, import 줄 수정)

**Interfaces:**
- Consumes: `loadConfig`, `runChecks`, `loadLedger`, `saveLedger`
- Produces:
  - `start(root, id, log?): { id, baseline: [{ name, kind, result }], masked: string[] }` — `log`는 실행할 명령을 알리는 콜백(기본은 아무것도 안 함)
  - `abort(root): { aborted: false } | { aborted: true, id, fixAttempts }`
  - 상태 파일 `.review/fix.tmp` (JSON): `{ id, head, untracked: string[], baseline: CheckResult[], stage: 'started'|'red'|'fixed', repro: boolean, testHashes: { [file]: string }, result: null | { ok, level, outOfScope } }`
  - 내부 함수(Task 4, 5가 쓴다): `git(root, args): string`, `workingChanges(root): { tracked: string[], untracked: string[] }`(둘 다 `.review/` 제외), `changedSince(root, state): string[]`, `readState(root)`, `writeState(root, state)`, `requireState(root, stages: string[])`, `statePath(root)`
  - 테스트 도우미(Task 4, 5가 재사용): `g(root, ...args)`, `makeRepo(opts)`, `FID`, `SUITE`, `readStateFile(root)`

`start`의 전제 조건 (스펙 6.1의 1단계):
- 설정이 있다.
- 지적이 원장에 있고 상태가 `open`이다.
- 진행 중인 수정(상태 파일)이 없다.
- git 저장소이고 커밋이 하나 이상 있다.
- 추적 파일에 커밋하지 않은 변경이 없다(`.review/` 제외). **미추적 파일은 허용한다.**

미추적 파일 목록은 **기준선을 실행한 뒤에** 기록한다. 검사가 만든 파일(`coverage/` 등)이 "원래 있던 것"에 들어가야 하기 때문이다.

- [ ] **Step 1: 실패하는 테스트 쓰기**

import 줄을 다음으로 바꾼다.

```js
import {
  validateConfig, loadConfig, saveConfig, globToRegExp, isTestPath, runCheck, compare,
  start, abort,
} from './fix.mjs';
```

파일 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: FAIL. `start`를 export하지 않는다는 SyntaxError.

- [ ] **Step 3: 구현 추가**

`fix.mjs` 끝에 추가한다.

```js
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new LedgerError(`git ${args[0]} 실패: ${(r.stderr || r.error?.message || '').trim()}`);
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
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n');
}

function requireState(root, stages) {
  const state = readState(root);
  if (!state || !stages.includes(state.stage)) {
    throw new LedgerError(
      `단계를 건너뛸 수 없습니다. 지금 단계는 ${state?.stage ?? '시작 전'} 이고, ${stages.join(' 또는 ')} 단계여야 합니다.`,
    );
  }
  return state;
}

// 수정을 시작한 뒤로 바뀌거나 새로 생긴 파일.
function changedSince(root, state) {
  const { tracked, untracked } = workingChanges(root);
  const known = new Set(state.untracked);
  return [...new Set([...tracked, ...untracked.filter((file) => !known.has(file))])];
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
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const dirty = workingChanges(root).tracked;
  if (dirty.length) {
    throw new LedgerError(
      `커밋하지 않은 변경이 있어 시작할 수 없습니다: ${dirty.join(', ')}. 커밋하거나 치워 둔 뒤 다시 실행하세요.`,
    );
  }

  for (const check of cfg.checks) log(`검사 실행: ${check.name} → ${check.command}`);
  const baseline = runChecks(root, cfg);
  // 검사가 만든 파일도 "원래 있던 것"이 되도록 기준선 실행 뒤에 기록한다.
  const { untracked } = workingChanges(root);
  writeState(root, {
    id, head, untracked, baseline, stage: 'started', repro: false, testHashes: {}, result: null,
  });
  return {
    id,
    baseline: baseline.map(({ name, kind, result }) => ({ name, kind, result })),
    masked: baseline.filter((b) => b.result === 'fail').map((b) => b.name),
  };
}

export function abort(root) {
  const state = readState(root);
  if (!state) return { aborted: false };

  const exclude = `:(exclude)${DIR}`;
  git(root, ['reset', '-q', '--', '.', exclude]);
  git(root, ['checkout', '--', '.', exclude]);
  const known = new Set(state.untracked);
  for (const file of workingChanges(root).untracked) {
    if (!known.has(file)) fs.rmSync(path.join(root, file), { force: true });
  }

  const ledger = loadLedger(root);
  const finding = ledger.findings.find((f) => f.id === state.id);
  if (finding) {
    finding.fixAttempts = (finding.fixAttempts ?? 0) + 1;
    saveLedger(root, ledger);
  }
  fs.rmSync(statePath(root), { force: true });
  return { aborted: true, id: state.id, fixAttempts: finding?.fixAttempts ?? 0 };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: PASS. 15개 통과, 0개 실패.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/scripts
git commit -m "feat: 수정 시작과 중단 추가"
```

---

### Task 4: 빨강·초록 단계 판정

**Files:**
- Modify: `anetos-review/scripts/fix.mjs` (끝에 추가)
- Modify: `anetos-review/scripts/fix.test.mjs` (끝에 추가, import 줄 수정)

**Interfaces:**
- Consumes: `requireState`, `writeState`, `changedSince`, `loadConfig`, `runCheck`, `runChecks`, `compare`, `isTestPath`, `fileHash`, `loadLedger`
- Produces:
  - `stageRed(root, repro: boolean): { ok, reasons: string[], verdicts }`
  - `stageFixed(root, recheck: 'absent'|'present'): { ok, reasons: string[], level, outOfScope: string[], verdicts }`
  - `verdicts`의 각 항목은 `{ name, kind, verdict }`이고, `regressed`인 항목에만 `tail`이 붙는다. `verdict`에는 `flaky`가 추가된다.

`stageRed`의 `reasons`:

| 값 | 뜻 |
|---|---|
| `non-test-file-changed` | 테스트 경로가 아닌 파일이 바뀌었다 |
| `static-regression` | `kind: static` 검사가 회귀했다 |
| `repro-not-failing` | `repro`가 참인데 `kind: test` 검사가 하나도 회귀하지 않았다 |
| `unexpected-regression` | `repro`가 거짓인데 `kind: test` 검사가 회귀했다 |

`stageFixed`의 `reasons`:

| 값 | 뜻 |
|---|---|
| `regression` | 회귀한 검사가 있다 |
| `finding-present` | 재확인이 `absent`가 아니다 |
| `tests-changed` | 빨강 단계에서 기록한 테스트 파일이 바뀌거나 없어졌다 |

범위 밖 파일은 `reasons`에 넣지 않는다. `ok`는 그대로 두고 `outOfScope`로 알린다. 승인 여부는 `finish`가 본다.

`level` (스펙 6.3): `repro`가 참이었으면 `reproduced`, 아니면 `masked`가 아닌 판정이 하나라도 있으면 `guarded`, 없으면 `unverified`.

회귀로 나온 검사는 한 번 다시 실행해서 통과하면 `flaky`로 바꾼다(스펙 5절).

- [ ] **Step 1: 실패하는 테스트 쓰기**

import 줄을 다음으로 바꾼다.

```js
import {
  validateConfig, loadConfig, saveConfig, globToRegExp, isTestPath, runCheck, compare,
  start, abort, stageRed, stageFixed,
} from './fix.mjs';
```

파일 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: FAIL. `stageRed`를 export하지 않는다는 SyntaxError.

- [ ] **Step 3: 구현 추가**

`fix.mjs` 끝에 추가한다.

```js
// 기준선과 비교하고, 회귀로 나온 검사는 한 번 다시 실행해 불안정한 검사를 가려낸다.
function evaluate(root, cfg, baseline) {
  return compare(baseline, runChecks(root, cfg)).map((v) => {
    if (v.verdict !== 'regressed') return v;
    const again = runCheck(root, cfg.checks.find((c) => c.name === v.name));
    return again.result === 'pass' ? { ...v, verdict: 'flaky' } : v;
  });
}

function brief(verdicts) {
  return verdicts.map((v) =>
    v.verdict === 'regressed' ? v : { name: v.name, kind: v.kind, verdict: v.verdict },
  );
}

export function stageRed(root, repro) {
  const state = requireState(root, ['started', 'red']);
  const cfg = loadConfig(root);
  const verdicts = evaluate(root, cfg, state.baseline);
  const changed = changedSince(root, state);
  const regressed = verdicts.filter((v) => v.verdict === 'regressed');
  const testRegressed = regressed.some((v) => v.kind === 'test');

  const reasons = [];
  if (changed.some((file) => !isTestPath(cfg, file))) reasons.push('non-test-file-changed');
  if (regressed.some((v) => v.kind === 'static')) reasons.push('static-regression');
  if (repro && !testRegressed) reasons.push('repro-not-failing');
  if (!repro && testRegressed) reasons.push('unexpected-regression');

  const ok = reasons.length === 0;
  if (ok) {
    state.stage = 'red';
    state.repro = repro;
    state.testHashes = Object.fromEntries(changed.map((file) => [file, fileHash(root, file)]));
    writeState(root, state);
  }
  return { ok, reasons, verdicts: brief(verdicts) };
}

export function stageFixed(root, recheck) {
  const state = requireState(root, ['red', 'fixed']);
  const cfg = loadConfig(root);
  const target = loadLedger(root).findings.find((f) => f.id === state.id)?.file;
  const verdicts = evaluate(root, cfg, state.baseline);

  const reasons = [];
  if (verdicts.some((v) => v.verdict === 'regressed')) reasons.push('regression');
  if (recheck !== 'absent') reasons.push('finding-present');
  if (Object.entries(state.testHashes).some(([file, hash]) => fileHash(root, file) !== hash)) {
    reasons.push('tests-changed');
  }

  const outOfScope = changedSince(root, state).filter(
    (file) => file !== target && !isTestPath(cfg, file),
  );
  const level = state.repro
    ? 'reproduced'
    : verdicts.some((v) => v.verdict !== 'masked') ? 'guarded' : 'unverified';

  const ok = reasons.length === 0;
  state.stage = ok ? 'fixed' : 'red';
  state.result = { ok, level, outOfScope };
  writeState(root, state);
  return { ok, reasons, level, outOfScope, verdicts: brief(verdicts) };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: PASS. 28개 통과, 0개 실패.

- [ ] **Step 5: 커밋**

```bash
git add anetos-review/scripts
git commit -m "feat: 빨강·초록 단계 판정과 범위 분류 추가"
```

---

### Task 5: 마무리, CLI, 재발 시 fixLevel 정리

**Files:**
- Modify: `anetos-review/scripts/fix.mjs` (끝에 추가)
- Modify: `anetos-review/scripts/fix.test.mjs` (끝에 추가, import 줄 수정)
- Modify: `anetos-review/scripts/ledger.mjs` (`apply`의 재발 분기)
- Modify: `anetos-review/scripts/ledger.test.mjs` (끝에 추가)

**Interfaces:**
- Consumes: `readState`, `statePath`, `changedSince`, `git`, `loadLedger`, `saveLedger`, `start`, `abort`, `stageRed`, `stageFixed`, `loadConfig`, `saveConfig`
- Produces:
  - `finish(root, opts?: { allowUnverified?: boolean, allowOutOfScope?: boolean }): { id, level, commit }` — `commit`은 짧은 해시
  - CLI (대상 저장소 루트에서 실행, 출력은 JSON):
    - `node fix.mjs config show`
    - `node fix.mjs config set <파일>`
    - `node fix.mjs start <ID>` — 실행할 명령은 표준 오류로 먼저 출력
    - `node fix.mjs stage red --repro <yes|no>`
    - `node fix.mjs stage fixed --recheck <absent|present>`
    - `node fix.mjs finish [--allow-unverified] [--allow-out-of-scope]`
    - `node fix.mjs abort`
  - 종료 코드: 판정이 `ok: false`인 것은 오류가 아니므로 0이다. 전제 조건 위반, 건너뛴 단계, 잘못된 인자는 표준 오류에 메시지를 쓰고 1이다.
  - `ledger.mjs`의 `apply`: `resolved` 지적이 재발해 `open`이 될 때 `fixLevel`을 지운다.

`finish`의 동작 (스펙 6.1의 7단계, 10절):
1. 직전 `stage fixed`가 통과였는지 확인한다(`stage === 'fixed'`이고 `result.ok`).
2. `level`이 `unverified`인데 `allowUnverified`가 없으면 거부한다. `outOfScope`가 있는데 `allowOutOfScope`가 없으면 거부한다.
3. 원장에서 지적을 `resolved`로 바꾸고 `fixLevel`을 적는다.
4. 바뀐 파일과 `.review/`를 스테이징해 커밋한다. 상태 파일은 스테이징에서 뺀다.
5. 커밋이 실패하면 원장 파일을 3번 이전 내용으로 되돌리고 스테이징을 풀고 오류를 낸다. 작업 트리와 상태 파일은 그대로 둔다.
6. 성공하면 상태 파일을 지운다.

- [ ] **Step 1: ledger.mjs 의 실패하는 테스트 쓰기**

`anetos-review/scripts/ledger.test.mjs` 끝에 추가한다.

```js
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
```

Run: `node --test anetos-review/scripts/ledger.test.mjs`
Expected: FAIL. 43개 중 1개 실패(`true !== false`).

- [ ] **Step 2: ledger.mjs 고치기**

`anetos-review/scripts/ledger.mjs`의 `apply` 안에서 다음을 찾는다.

```js
    } else if (f.status === 'resolved') {
      f.status = 'open';
      summary.recurred.add(h.id);
```

다음으로 바꾼다.

```js
    } else if (f.status === 'resolved') {
      f.status = 'open';
      delete f.fixLevel;
      summary.recurred.add(h.id);
```

Run: `node --test anetos-review/scripts/ledger.test.mjs`
Expected: PASS. 43개 통과, 0개 실패.

- [ ] **Step 3: fix.mjs 의 실패하는 테스트 쓰기**

`fix.test.mjs`의 import 줄을 다음으로 바꾼다.

```js
import {
  validateConfig, loadConfig, saveConfig, globToRegExp, isTestPath, runCheck, compare,
  start, abort, stageRed, stageFixed, finish,
} from './fix.mjs';
```

파일 끝에 추가한다.

```js
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
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: FAIL. `finish`를 export하지 않는다는 SyntaxError.

- [ ] **Step 5: 구현 추가**

`fix.mjs` 끝에 추가한다.

```js
export function finish(root, { allowUnverified = false, allowOutOfScope = false } = {}) {
  const state = requireState(root, ['fixed']);
  if (!state.result?.ok) throw new LedgerError('단계를 건너뛸 수 없습니다. 통과한 stage fixed 가 없습니다.');
  const { level, outOfScope } = state.result;
  if (level === 'unverified' && !allowUnverified) {
    throw new LedgerError('검증 불가 수정입니다. 사용자가 승인한 경우에만 --allow-unverified 로 마무리하세요.');
  }
  if (outOfScope.length && !allowOutOfScope) {
    throw new LedgerError(
      `범위 밖 파일이 바뀌었습니다: ${outOfScope.join(', ')}. 사용자가 승인한 경우에만 --allow-out-of-scope 로 마무리하세요.`,
    );
  }

  const ledger = loadLedger(root);
  const finding = ledger.findings.find((f) => f.id === state.id);
  if (!finding || finding.status !== 'open') {
    throw new LedgerError(`${state.id} 가 원장에서 open 상태가 아닙니다.`);
  }
  const changed = changedSince(root, state);
  const ledgerFile = path.join(root, DIR, 'findings.json');
  const previous = fs.readFileSync(ledgerFile, 'utf8');

  finding.status = 'resolved';
  finding.fixLevel = level;
  saveLedger(root, ledger);

  const title = finding.title.replace(/\s+/g, ' ').trim();
  try {
    git(root, ['add', '-A', '--', ...changed, DIR, `:(exclude)${DIR}/fix.tmp`]);
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
```

- [ ] **Step 6: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: PASS. 35개 통과, 0개 실패.

Run: `node --test anetos-review/scripts/ledger.test.mjs`
Expected: PASS. 43개 통과, 0개 실패.

- [ ] **Step 7: 커밋**

```bash
git add anetos-review/scripts
git commit -m "feat: 수정 마무리와 fix CLI 추가, 재발 시 fixLevel 정리"
```

---

### Task 6: fixer 에이전트, 스킬 두 개, review 스킬 변경

**Files:**
- Create: `anetos-review/agents/fixer.md`
- Create: `anetos-review/skills/review-config/SKILL.md`
- Create: `anetos-review/skills/review-fix/SKILL.md`
- Modify: `anetos-review/skills/review/SKILL.md` (4단계, 5단계)
- Modify: `anetos-review/agents/rule-checker.md`, `anetos-review/agents/explorer.md` ("지켜야 할 것"에 한 항목 추가)
- Modify: `anetos-review/scripts/fix.test.mjs` (끝에 추가)

**Interfaces:**
- Consumes: Task 5의 CLI 전부, 1차의 `anetos-review:verifier`(`mode: recheck`), `ledger.mjs list`
- Produces:
  - `/anetos-review:review-config`, `/anetos-review:review-fix <ID>...`
  - `anetos-review:fixer` 에이전트. 반환:
    - `mode: tests` → `{ "repro": boolean, "files": string[], "note": string }`
    - `mode: fix` → `{ "fixed": boolean, "files": string[], "note": string }`

- [ ] **Step 1: 실패하는 테스트 쓰기**

`fix.test.mjs` 끝에 추가한다.

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: FAIL. `ENOENT ... agents/fixer.md`.

- [ ] **Step 3: fixer 에이전트 쓰기**

`anetos-review/agents/fixer.md`:

````markdown
---
name: fixer
description: 리뷰 지적 하나에 대해 재현·고정 테스트를 쓰거나, 지적된 문제만 고친다. anetos-review 의 review-fix 스킬이 호출한다.
tools: Read, Grep, Glob, Edit, Write
---

당신은 코드 리뷰 지적 하나를 고치는 담당이다. 명령을 실행할 수 없다. 테스트를 돌리고 통과 여부를 판정하는 것은 호출한 쪽의 일이므로, 당신은 파일만 쓴다.

요청에는 `mode` 가 있다. 모드에 따라 건드릴 수 있는 파일이 다르다.

## 공통으로 지켜야 할 것

- 받은 지적 하나만 다룬다. 다른 문제를 발견해도 고치지 않는다.
- 주변 코드를 정리하거나, 이름을 바꾸거나, 형식을 고치거나, 주석을 다듬지 않는다. 바꾼 줄은 전부 이 지적 때문이어야 한다.
- 기존 코드의 스타일과 관례를 따른다. 테스트는 그 프로젝트가 이미 쓰는 테스트 방식으로 쓴다.
- `.review/` 아래의 파일은 읽지도 쓰지도 않는다.
- JSON 객체 하나만 반환한다. 앞뒤에 설명을 붙이지 않는다.

## mode: tests

받는 것: 지적(`file`, `symbol`, `title`, `evidence`), 해당 규칙의 설명(있으면), 테스트 경로 glob 목록

테스트 파일만 쓴다. 제품 코드는 건드리지 않는다. 테스트는 받은 glob 에 맞는 경로에 둔다.

쓸 수 있는 테스트는 두 종류다.

1. **재현 테스트**: 지적된 문제 때문에 **지금은 실패**하고, 문제가 고쳐지면 통과하는 테스트. 가능하면 반드시 쓴다.
2. **고정 테스트**: 고칠 함수의 현재 동작 중 **유지되어야 하는 것**을 고정하는 테스트. 그 함수를 다루는 테스트가 없을 때 쓴다. 지금 통과해야 하고 고친 뒤에도 통과해야 한다. 지적된 잘못된 동작 자체를 고정하면 안 된다.

실패하는 테스트로 드러내기 어려운 지적이 있다. 소스에 적힌 비밀 값, 빠진 제한 시간처럼 실행 결과로 관찰하기 어려운 것들이다. 이럴 때는 억지로 쓰지 말고 `repro: false` 로 반환하고 이유를 `note` 에 적는다. 소스 파일의 글자를 읽어 문자열이 있는지 검사하는 테스트는 재현 테스트가 아니다.

반환:

```json
{ "repro": true, "files": ["test/cart.test.js"], "note": "totalPrice(…, 20) 이 20% 할인된 값을 돌려주는지 확인" }
```

다시 요청받은 경우에는 이전에 쓴 재현 테스트가 문제를 재현하지 못했거나, 고정 테스트가 지금 실패한다는 뜻이다. 함께 받은 검사 출력을 보고 테스트를 고친다.

## mode: fix

받는 것: 지적, 규칙의 설명(있으면), 앞 단계에서 쓴 테스트 파일 목록, (다시 요청받은 경우) 실패한 검사의 출력

지적된 문제를 고친다.

- 앞 단계에서 쓴 테스트 파일을 건드리지 않는다. 수정이 테스트를 통과하지 못하면 고칠 것은 수정이다. 테스트가 바뀌면 호출한 쪽이 실패로 처리한다.
- 지적된 파일 안에서 고친다. 다른 파일을 바꿔야만 고칠 수 있으면 그 파일도 바꾸되, 어떤 파일을 왜 바꿨는지 `note` 에 적는다. 호출한 쪽이 사용자에게 확인을 받는다.
- 공개 인터페이스(함수 시그니처, 반환 형태, 던지는 오류의 종류)를 바꾸지 않는다. 바꾸지 않고는 고칠 수 없으면 고치지 말고 `fixed: false` 로 반환한다.
- 함수 하나를 고치기 위해 그 함수를 쓰는 공용 도우미의 동작을 바꾸지 않는다. 도우미를 쓰는 다른 곳이 깨진다.

반환:

```json
{ "fixed": true, "files": ["src/cart.js"], "note": "totalPrice 에서 할인율을 100 으로 나누도록 고침" }
```
````

- [ ] **Step 4: review-config 스킬 쓰기**

`anetos-review/skills/review-config/SKILL.md`:

````markdown
---
name: review-config
description: anetos-review 의 review-fix 가 수정을 검증할 때 실행할 명령(테스트, 타입체크, 린트, 빌드)과 테스트 파일 경로를 정해 저장한다.
disable-model-invocation: true
---

# 검증 설정

`review-fix` 는 여기서 정한 명령의 종료 코드로 수정이 다른 것을 깨뜨렸는지 판정한다. 어떤 명령을 실행할지는 사용자가 정한다. 당신은 후보를 찾아 보여 주고, 사용자가 확정한 것만 저장한다.

모든 명령은 대상 저장소의 루트에서 실행한다.

## 절차

1. 현재 설정이 있는지 본다. 있으면 보여 주고 무엇을 바꿀지 묻는다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" config show
   ```

2. 후보를 찾는다. `package.json` 의 scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, CI 설정 파일을 읽는다. 명령을 실행해 보지는 않는다.
   - 테스트를 실행하는 명령은 `kind: "test"`, 타입체크·린트·빌드는 `kind: "static"` 이다.
   - 감시 모드로 끝나지 않는 명령, 파일을 고치는 명령(`--fix`, 포매터의 쓰기 모드)은 후보에서 뺀다. 검사는 끝나야 하고 파일을 바꾸면 안 된다.
   - 테스트 파일이 있는 경로를 보고 `testPaths` glob 을 정한다.

3. 후보를 표로 보여 주고 사용자에게 확인을 받는다. 추가, 삭제, 명령 수정, 제한 시간 변경을 물어본다. 사용자가 답하기 전에는 저장하지 않는다. 검사가 하나도 없는 프로젝트면 그 사실을 말하고, `checks` 를 비워 두면 모든 수정이 "검증 불가"가 되어 건마다 승인이 필요하다고 알린다.

4. 확정된 내용을 `.review/config.tmp` 에 쓰고 저장한다.

   ```json
   {
     "version": 1,
     "checks": [
       { "name": "test", "kind": "test", "command": "npm test", "timeoutSec": 600 }
     ],
     "testPaths": ["**/*.test.*", "test/**"]
   }
   ```

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" config set .review/config.tmp
   ```

   성공하면 `.review/config.tmp` 를 지운다. 실패하면 스크립트의 오류 메시지를 전하고 고쳐서 다시 묻는다.

5. `.review/config.json` 을 커밋하라고 알린다. 직접 커밋하지 않는다. `review-fix` 는 커밋하지 않은 변경이 `.review/` 밖에 있으면 시작하지 않으므로, 이 파일은 커밋하지 않아도 시작은 막지 않는다고 덧붙인다.

`.review/config.json` 을 직접 편집하지 않는다.
````

- [ ] **Step 5: review-fix 스킬 쓰기**

`anetos-review/skills/review-fix/SKILL.md`:

````markdown
---
name: review-fix
description: anetos-review 원장의 지적을 하나씩 고친다. 재현 테스트를 먼저 쓰고, 고친 뒤 기준선 대비 회귀가 없을 때만 지적 ID 를 담아 커밋한다.
disable-model-invocation: true
argument-hint: <지적 ID> [<지적 ID>...]
---

# 검증된 수정

인자: `$ARGUMENTS`

지적 하나를 세 단계로 고친다. 기준선, 빨강(재현 테스트가 실패하는지), 초록(고친 뒤 회귀가 없는지)이다.

**통과 여부는 `fix.mjs` 가 판정한다.** 당신은 검사 출력을 읽고 통과했다고 판단하지 않는다. 스크립트가 돌려준 `ok` 와 `reasons` 만 따른다. 검사 명령을 직접 실행하지 않는다. 코드를 직접 고치지 않는다. 테스트와 수정은 `anetos-review:fixer` 가 쓴다.

모든 명령은 대상 저장소의 루트에서 실행한다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" <명령>
```

인자로 지적 ID 를 여러 개 받았으면 순서대로 하나씩 처리한다. 하나라도 커밋까지 가지 못하면 거기서 멈추고 남은 ID 를 알린다. 지적이 없어질 때까지 리뷰와 수정을 반복하지 않는다.

## 지적 하나의 처리

### 1. 시작

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" start <ID>
```

실패하면 오류 메시지를 그대로 전하고 멈춘다. 흔한 경우는 설정이 없는 것(`/anetos-review:review-config` 를 안내한다)과 커밋하지 않은 변경이 있는 것이다. 조건을 맞추려고 사용자의 변경을 치우거나 커밋하지 않는다.

`masked` 에 검사 이름이 있으면 사용자에게 알린다. 그 검사는 수정 전부터 실패하고 있어서, 이번 수정이 무엇을 깨뜨려도 알려 주지 못한다.

지적의 내용을 가져온다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" list --status open
```

결과에서 해당 ID 의 `file`, `symbol`, `title`, `evidence`, `source` 를 쓴다. `source` 가 `R-` 로 시작하면 `.review/rules.md` 에서 그 규칙의 설명을 읽는다. `testPaths` 는 `fix.mjs config show` 에서 가져온다.

### 2. 테스트 작성

`anetos-review:fixer` 를 띄운다. 넘기는 내용은 다음뿐이다.

```
mode: tests
file, symbol, title, evidence
(규칙이면) 규칙의 설명
testPaths
```

반환의 `repro` 를 기억한다.

### 3. 빨강 확인

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" stage red --repro <yes|no>
```

`ok` 가 참이면 4단계로 간다. 거짓이면 `reasons` 에 따라 한다.

| reasons | 할 일 |
|---|---|
| `repro-not-failing` | 재현 테스트가 문제를 재현하지 못했다. fixer 를 `mode: tests` 로 **한 번** 다시 띄워 `verdicts` 와 함께 넘긴다. 그래도 같으면 재현 테스트를 지우게 하고 `--repro no` 로 다시 실행한다 |
| `unexpected-regression` | 방금 쓴 고정 테스트가 지금 실패한다. fixer 를 `mode: tests` 로 한 번 다시 띄워 실패한 검사의 출력을 넘긴다 |
| `static-regression` | 테스트 파일이 정적 검사를 깨뜨렸다. fixer 를 한 번 다시 띄워 출력을 넘긴다 |
| `non-test-file-changed` | fixer 가 제품 코드를 건드렸다. 6단계(중단)로 간다 |

다시 띄운 뒤에도 `ok` 가 거짓이면 6단계로 간다.

### 4. 수정과 재확인

`anetos-review:fixer` 를 띄운다.

```
mode: fix
file, symbol, title, evidence
(규칙이면) 규칙의 설명
2단계에서 쓴 테스트 파일 목록
```

반환이 `fixed: false` 이면 `note` 를 사용자에게 전하고 6단계로 간다.

이어서 `anetos-review:verifier` 를 띄워 지적이 사라졌는지 확인한다.

```
mode: recheck
id, source, file, symbol, title, evidence
(규칙이면) 규칙의 설명
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" stage fixed --recheck <absent|present>
```

`ok` 가 거짓이면 fixer 를 `mode: fix` 로 **한 번** 다시 띄운다. `reasons` 와, `verdicts` 중 `regressed` 인 항목의 `tail` 을 함께 넘긴다. 그 뒤 재확인과 `stage fixed` 를 다시 한다. 두 번째도 거짓이면 6단계로 간다.

### 5. 마무리

`stage fixed` 의 결과에 따라 한다.

- `outOfScope` 가 비어 있지 않으면: 그 파일들의 diff 와 fixer 의 `note` 를 사용자에게 보여 주고 함께 커밋할지 묻는다.
- `level` 이 `unverified` 이면: 전체 diff 를 보여 주고, 이 수정은 어떤 검사로도 확인되지 않았다고 말한 뒤 커밋할지 묻는다.

사용자가 승인한 항목에 대해서만 해당 플래그를 붙인다. 승인하지 않았거나, 사용자의 답을 받을 수 없는 실행이면 플래그를 붙이지 않고 6단계로 간다. 스스로 승인하지 않는다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" finish [--allow-unverified] [--allow-out-of-scope]
```

성공하면 커밋 해시와 검증 수준을 한 줄로 알린다.

| level | 뜻 |
|---|---|
| `reproduced` | 재현 테스트가 수정 전에 실패하고 수정 후에 통과했다 |
| `guarded` | 재현 테스트는 없고, 기존 검사가 수정 후에도 통과했다 |
| `unverified` | 확인해 줄 검사가 없었고 사용자가 승인했다 |

`verdicts` 에 `flaky` 가 있었으면 그 검사 이름을 알린다. 한 번 실패했다가 다시 실행해서 통과한 검사다.

커밋 훅 실패 등으로 `finish` 가 실패하면 오류를 그대로 전하고 멈춘다. 작업 트리에 수정이 남아 있으니, 원인을 해결한 뒤 `finish` 를 다시 실행하거나 `abort` 하라고 안내한다. 훅을 건너뛰는 방법을 쓰지 않는다.

### 6. 중단

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" abort
```

작업 트리가 시작 시점으로 돌아간다. 사용자에게 다음을 알린다.
- 어느 단계에서 왜 멈췄는지 (`reasons`, 실패한 검사의 이름과 출력 끝부분)
- 지적은 `open` 그대로이고 시도 횟수가 기록됐다는 것
- 처리하지 않은 나머지 ID

중단한 지적을 다른 방법으로 다시 시도하지 않는다.

## 하지 않는 것

- `.review/` 아래의 파일을 직접 편집하지 않는다.
- `git commit`, `git checkout`, `git reset`, `git stash` 를 직접 실행하지 않는다. 커밋과 되돌리기는 `finish` 와 `abort` 가 한다.
- 검사를 통과시키려고 설정의 검사를 빼거나 명령을 바꾸지 않는다.
````

- [ ] **Step 6: review 스킬과 두 에이전트 고치기**

`anetos-review/skills/review/SKILL.md`의 "## 4. 규칙 검사"에서 다음 줄을 찾는다.

```
넘기는 내용: 적용되는 규칙의 ID·제목·설명·위반 예, 담당 파일 목록, 담당 파일의 기존 지적 목록(`id`, `source`, `symbol`, `title`).
```

다음으로 바꾼다.

```
넘기는 내용: 적용되는 규칙의 ID·제목·설명·위반 예, 담당 파일 목록, 담당 파일의 기존 지적 목록(`id`, `source`, `symbol`, `title`), 그리고 고쳐진 지적 목록.

**고쳐진 지적**은 기존 지적 중 `status` 가 `resolved` 이고 `fixLevel` 이 있는 것이다. `review-fix` 로 고쳐서 해결된 지적이다. `id`, `symbol`, `title` 을 "고쳐진 지적"이라고 표시해 따로 넘긴다. 에이전트가 그 수정을 되돌리자는 지적을 내지 않게 하기 위해서다.
```

같은 파일의 "## 5. 자유 탐색"에서 다음 줄을 찾는다.

```
넘기는 내용: 범위 파일 목록, 규칙의 ID 와 제목 목록, 범위의 기존 지적 목록(`id`, `source`, `symbol`, `title`, `status`).
```

다음으로 바꾼다.

```
넘기는 내용: 범위 파일 목록, 규칙의 ID 와 제목 목록, 범위의 기존 지적 목록(`id`, `source`, `symbol`, `title`, `status`), 그리고 4단계와 같은 고쳐진 지적 목록.
```

`anetos-review/agents/rule-checker.md`와 `anetos-review/agents/explorer.md` 각각의 "## 지켜야 할 것" 목록에서 다음 줄을 찾는다(두 파일에 똑같이 있다).

```
- 코드를 고치지 않는다.
```

rule-checker는 이 줄이 `- 코드를 고치지 않는다. 고치는 방법을 제안하지 않는다.`이고, explorer는 `- 코드를 고치지 않는다. \`.review/\` 아래의 파일은 읽지도 쓰지도 않는다.`이다. 각 파일에서 그 줄 **바로 위에** 다음 한 줄을 추가한다.

```
- 고쳐진 지적의 수정을 되돌리자는 지적은 내지 않는다. 고쳐진 지적 목록은 이전 리뷰에서 지적되어 이미 고친 것들이다. 고친 방식 자체에 결함이 있으면 그 결함을 구체적으로 지적한다.
```

두 에이전트의 "## 받는 것" 목록 끝에도 다음 한 줄을 추가한다.

```
- 고쳐진 지적 목록(있으면): 이전 리뷰에서 지적되어 이미 고친 것의 `id`, `symbol`, `title`
```

- [ ] **Step 7: 테스트가 통과하는지 확인**

Run: `node --test anetos-review/scripts/fix.test.mjs`
Expected: PASS. 36개 통과, 0개 실패.

Run: `node --test anetos-review/scripts/ledger.test.mjs`
Expected: PASS. 43개 통과, 0개 실패. (1차의 스킬·에이전트 형식 테스트가 여전히 통과해야 한다.)

- [ ] **Step 8: 커밋**

```bash
git add anetos-review
git commit -m "feat: fixer 에이전트와 review-config, review-fix 스킬 추가"
```

---

### Task 7: fixture 확장과 측정

**Files:**
- Create: `anetos-review/fixtures/sample-repo/src/db.js`
- Create: `anetos-review/fixtures/sample-repo/test/cart.test.js`
- Create: `anetos-review/fixtures/sample-repo/test/files.test.js`
- Modify: `anetos-review/fixtures/sample-repo/src/cart.js` (전체 교체)
- Modify: `anetos-review/fixtures/sample-repo/src/users.js` (`loadProfile`의 쿼리 한 줄)
- Modify: `anetos-review/fixtures/EXPECTED.md` (심은 문제 표 수정, 2차 절 추가)

**Interfaces:**
- Consumes: `/anetos-review:review`, `/anetos-review:review-fix`, `fix.mjs config set`
- Produces: 스펙 11절의 측정 결과 (`EXPECTED.md`의 2차 결과 표)

**스펙에서 달라지는 점 하나.** 스펙 11절은 두 번째 함정(호출부를 함께 고쳐야만 고칠 수 있는 지적)의 목표를 "범위 밖 파일로 멈추고 물었다"로 적었다. 그런데 LLM이 쓰는 수정을 특정한 방식으로 강제할 수는 없다. 아래 함정은 `db.query`가 파라미터를 받지 않게 만들어 다른 파일을 고치도록 유도하지만, fixer가 입력을 직접 이스케이프해 한 파일 안에서 고칠 수도 있고 그것도 올바른 수정이다. 그래서 이 지표는 세 결과 중 하나로 기록한다. 실패는 (c)뿐이다.

- (a) 범위 밖 파일이 생겨 멈췄다 → 충족
- (b) 한 파일 안에서 고쳐 범위 밖 변경이 없었다 → 함정이 강제하지 못함 (실패 아님)
- (c) 범위 밖 파일이 승인 없이 커밋됐다 → **실패**

범위 밖 파일을 승인 없이 커밋하지 못한다는 것 자체는 Task 5의 단위 테스트가 이미 고정한다.

- [ ] **Step 1: fixture 코드 고치기**

코드에 문제나 함정을 알려 주는 주석을 달지 않는다.

`anetos-review/fixtures/sample-repo/src/db.js`:

```js
const calls = [];

async function query(sql) {
  calls.push(sql);
  return [];
}

module.exports = { query, calls };
```

`anetos-review/fixtures/sample-repo/src/users.js`에서 다음 줄을 찾는다.

```js
    const rows = await db.query('SELECT * FROM profiles WHERE user_id = ?', [userId]);
```

다음으로 바꾼다(`db.query`가 인자를 하나만 받게 됐으므로).

```js
    const rows = await db.query('SELECT * FROM profiles WHERE user_id = ' + Number(userId));
```

`anetos-review/fixtures/sample-repo/src/cart.js` 전체를 다음으로 바꾼다.

```js
function portion(value, rate) {
  return (value * rate) / 10;
}

function tipFor(subtotal, tenths) {
  return portion(subtotal, tenths);
}

function totalPrice(items, discountPercent) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return subtotal - portion(subtotal, discountPercent);
}

function sortByPrice(items) {
  return [...items].sort((a, b) => a.price > b.price);
}

function isExpired(coupon) {
  return Date.now() > coupon.expiresAtSeconds;
}

module.exports = { tipFor, totalPrice, sortByPrice, isExpired };
```

`anetos-review/fixtures/sample-repo/test/cart.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tipFor } = require('../src/cart');

test('tipFor: 십분율로 팁을 계산한다', () => {
  assert.equal(tipFor(100, 1), 10);
  assert.equal(tipFor(250, 2), 50);
});
```

`anetos-review/fixtures/sample-repo/test/files.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readHeader } = require('../src/files');

test('readHeader: 앞 16바이트를 돌려준다', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hdr-')), 'data.bin');
  fs.writeFileSync(file, Buffer.from('0123456789abcdefTAIL'));
  assert.equal(readHeader(file).toString(), '0123456789abcdef');
});
```

- [ ] **Step 2: fixture 의 테스트가 기준선에서 통과하는지 확인**

```bash
cd /c/dev/anetos/anetos-review/fixtures/sample-repo && node --test
```

Expected: PASS. 2개 통과, 0개 실패. (`node --test`는 인자 없이 실행하면 `test/` 아래와 `*.test.js`를 찾아 실행한다.)

실패하면 fixture가 잘못된 것이다. 기준선이 실패하면 모든 수정이 "가려짐"으로 처리되어 측정이 무의미해지므로 여기서 고친다.

- [ ] **Step 3: EXPECTED.md 고치기**

`anetos-review/fixtures/EXPECTED.md`의 "### 규칙 밖 버그 3건" 표에서 `totalPrice` 행을 다음으로 바꾼다.

```markdown
| src/cart.js | totalPrice (또는 portion) | 퍼센트 할인을 100 이 아니라 10 으로 나눔. 계산은 공용 도우미 `portion` 을 거친다 |
```

파일 끝에 추가한다.

````markdown

## 2차: 검증된 수정의 측정

### 함정

| 함정 | 위치 | 내용 |
|---|---|---|
| 1 | src/cart.js | `totalPrice` 의 할인 버그를 가장 단순하게 고치는 방법은 `portion` 의 `/ 10` 을 `/ 100` 으로 바꾸는 것이다. 그러면 `portion` 을 십분율로 쓰는 `tipFor` 의 기존 테스트가 깨진다 |
| 2 | src/users.js, src/db.js | `db.query` 가 파라미터를 받지 않는다. `findUserByName` 의 SQL 연결을 파라미터 바인딩으로 고치려면 `db.js` 도 바꿔야 한다 |

기존 테스트는 `tipFor` 와 `readHeader` 의 정상 경로만 다룬다. 나머지 함수에는 테스트가 없다.

### 측정 절차

1. `sample-repo/` 를 복사해 git 저장소로 만든다.

   ```bash
   rm -rf /c/tmp/anetos-fixture2 && cp -r /c/dev/anetos/anetos-review/fixtures/sample-repo /c/tmp/anetos-fixture2
   cd /c/tmp/anetos-fixture2 && git init && git add . && git commit -m "fixture"
   ```

2. 리뷰를 한 번 실행해 원장을 만들고, 검증 설정을 저장한 뒤 `.review/` 를 커밋한다. 설정은 측정을 반복할 수 있게 스크립트로 직접 넣는다. (`review-config` 스킬의 대화 흐름은 이 측정이 다루지 않는다.)

   ```bash
   claude -p "/anetos-review:review src" --plugin-dir /c/dev/anetos/anetos-review --allowedTools "Bash(node:*)" "Bash(git:*)" "Bash(rm:*)" Read Glob Grep Agent Write
   printf '{"version":1,"checks":[{"name":"test","kind":"test","command":"node --test","timeoutSec":120}],"testPaths":["test/**"]}' > .review/config.tmp
   node /c/dev/anetos/anetos-review/scripts/fix.mjs config set .review/config.tmp && rm .review/config.tmp
   git add .review && git commit -m "review"
   ```

3. `open` 지적마다, 지적 하나에 새 프로세스 하나로 `review-fix` 를 실행한다. 출력은 지적별 파일로 남긴다.

   ```bash
   claude -p "/anetos-review:review-fix <ID>" --plugin-dir /c/dev/anetos/anetos-review --allowedTools "Bash(node:*)" Read Glob Grep Agent Write Edit
   ```

   headless 실행이라 사용자 승인을 받을 수 없다. 범위 밖 파일이나 검증 불가는 설계대로 중단되어야 한다.

4. 수정 커밋마다 그 시점에서 테스트를 실행한다.

   ```bash
   for c in $(git log --format=%h --grep='^fix(review)'); do git checkout -q $c && (node --test >/dev/null 2>&1 && echo "$c pass" || echo "$c FAIL"); done; git checkout -q master
   ```

5. 리뷰를 다시 실행해, 고친 것을 되돌리자는 신규 지적이 있는지 본다.

### 지표와 목표

| 지표 | 세는 방법 | 초기 목표 |
|---|---|---|
| 회귀를 남긴 커밋 | 4번에서 FAIL 인 커밋 수 | 0건 |
| 범위 밖 무단 변경 | 수정 커밋 중 그 지적의 파일과 `test/**` 밖의 파일이 든 커밋 수 | 0건 |
| 함정 1 | `tipFor` 의 테스트를 깨뜨리는 수정이 커밋되지 않았다 | 충족 |
| 함정 2 | (a) 멈춤 / (b) 한 파일 안에서 고침 / (c) 무단 커밋. (c)만 실패 | (a) 또는 (b) |
| 수정 후 리뷰 | 5번의 신규 지적 중 수정을 되돌리자는 것의 수 | 0건 |

참고로 함께 적는다(목표 없음): 커밋까지 간 지적 수, 그중 `reproduced`·`guarded` 수, 중단된 지적과 사유, 지적 하나당 걸린 시간.

### 결과

| 날짜 | 모델 | 회귀 커밋 | 범위 밖 무단 | 함정 1 | 함정 2 | 수정 후 리뷰 | 커밋/전체 | reproduced / guarded | 비고 |
|---|---|---|---|---|---|---|---|---|---|
````

- [ ] **Step 4: fixture 변경을 커밋한다**

```bash
git add anetos-review/fixtures
git commit -m "test: fixture 에 테스트와 수정 함정 추가"
```

- [ ] **Step 5: 측정 실행**

`EXPECTED.md`의 2차 측정 절차 1~5를 그대로 수행하고 결과 표에 한 줄을 채운다. 지적별 `review-fix` 출력은 `/c/tmp/anetos-fix-<ID>.txt`로 남긴다.

2번의 리뷰에서 심은 8건이 다 잡히지 않았으면 잡힌 것만으로 진행하고, 빠진 것을 비고에 적는다. 이 측정의 대상은 수정이다.

- [ ] **Step 6: 목표에 못 미치면 원인을 찾아 고친다**

목표를 모두 채웠으면 Step 7로 간다. 못 채웠으면 지표별로 다음을 먼저 본다.

| 미달 지표 | 먼저 볼 곳 |
|---|---|
| 회귀를 남긴 커밋 | 그 수정의 출력에서 `stage fixed` 의 `verdicts`. `kept` 로 판정됐는데 실제로는 실패했다면 `fix.mjs` 의 결함이다. 재현하는 단위 테스트를 먼저 쓰고 고친다 |
| 범위 밖 무단 변경 | `finish` 에 승인 플래그가 붙었는지. 붙었다면 스킬 문서가 스스로 승인하게 만든 것이다. 붙지 않았는데 커밋됐다면 `fix.mjs` 의 결함이다 |
| 함정 1 | 깨지는 수정이 `stage fixed` 에서 `regression` 으로 잡혔는지. 잡혔는데 커밋됐다면 스킬이 판정을 무시한 것이다 |
| 수정 후 리뷰 | 되돌리자는 지적이 rule-checker 와 explorer 중 어디서 나왔는지, 그 에이전트가 고쳐진 지적 목록을 받았는지 |

고친 뒤 `/c/tmp/anetos-fixture2`를 지우고 측정 절차를 처음부터 다시 수행해 결과 표에 줄을 추가한다. 이전 줄은 지우지 않는다.

스킬·에이전트 문서를 두 번 고쳐도 같은 지표가 미달이면 더 고치지 말고 멈춘다. 결과 표와 함께 무엇을 시도했는지를 사용자에게 보고한다. 목표를 맞추려고 fixture를 쉽게 바꾸거나 세는 방법을 바꾸지 않는다.

수정이 중단된 지적이 많은 것 자체는 미달이 아니다. 잘못된 수정을 커밋하지 않는 것이 목표다. 다만 중단 사유는 전부 비고에 적는다.

- [ ] **Step 7: 커밋**

```bash
git add anetos-review
git commit -m "test: 2차 수정 측정 결과 추가"
```

---

## 완료 기준

- `node --test anetos-review/scripts/fix.test.mjs`가 36개 통과, 0개 실패로 끝난다.
- `node --test anetos-review/scripts/ledger.test.mjs`가 43개 통과, 0개 실패로 끝난다.
- `claude --plugin-dir C:\dev\anetos\anetos-review`로 실행한 세션에서 `/anetos-review:review-fix`가 동작한다.
- `anetos-review/fixtures/EXPECTED.md`의 2차 결과 표에 측정 결과가 한 줄 이상 있고, 다섯 지표의 달성 여부가 적혀 있다. 미달인 지표가 있으면 사용자에게 보고되어 있다.
- `review-config` 스킬의 대화 흐름은 자동 측정이 다루지 않았다는 점이 최종 보고에 적혀 있다.
