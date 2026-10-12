# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 무엇인가

Claude Code 플러그인 두 개를 담은 마켓플레이스 저장소다 (`.claude-plugin/marketplace.json`). 빌드 단계, `package.json`, 린터가 없다. 스크립트는 Node 표준 라이브러리만 쓴다.

- `anetos-review`: 스킬 4개 + 서브에이전트 4개 + Node 스크립트 2개로 된 코드 리뷰·수정 플러그인
- `anetos-process`: 위 플러그인의 진행 상황을 보여 주는 mod (TypeScript, `claude-code` 엔진 API)

문서, 주석, 오류 메시지, 테스트 이름, 커밋 메시지는 모두 한국어다. 커밋은 `feat:` / `fix:` / `test:` / `docs:` 접두사 + 한국어 제목, 본문은 `- ` 목록.

## 명령

```bash
# anetos-review 스크립트 테스트 (약 35초, 임시 git 저장소를 만들어 실제 검사 명령을 실행한다)
node --test anetos-review/scripts/*.test.mjs

# 파일 하나 / 테스트 하나
node --test anetos-review/scripts/ledger.test.mjs
node --test --test-name-pattern="<테스트 이름의 일부>" anetos-review/scripts/fix.test.mjs

# 두 플러그인 사이의 대조 테스트
node --experimental-strip-types --test tests/process-contract.test.mjs

# mod 검증과 테스트 (anetos-process/tests 는 claude-code/testing 을 쓰므로 node --test 로는 돌지 않는다)
claude plugin validate anetos-process
claude plugin test anetos-process

# 플러그인을 붙여 실행
claude --plugin-dir ./anetos-review --plugin-dir ./anetos-process
```

`node --test anetos-review/scripts/` 처럼 디렉터리를 넘기면 실패한다. glob 이나 파일을 넘긴다.

## 구조

### 판단과 판정의 분리

이 저장소의 핵심 설계다. **판단은 LLM 서브에이전트가, 판정은 스크립트가 한다.**

- 에이전트(`agents/*.md`)는 JSON 만 반환한다. `rule-checker`, `explorer`, `verifier` 는 읽기 전용이고 `fixer` 만 파일을 쓰며, 어느 에이전트도 명령을 실행하지 못한다.
- 스킬(`skills/*/SKILL.md`)은 에이전트의 반환을 모아 임시 파일(`.review/*.tmp`)에 쓰고 스크립트에 넘기는 절차서다. 스킬은 무엇이 같은 지적인지, 수정이 통과했는지를 스스로 정하지 않는다.
- `scripts/ledger.mjs` 가 지적의 동일성·재발·결정 충돌을, `scripts/fix.mjs` 가 수정의 통과 여부를 판정한다.

스킬이나 에이전트 문서를 고칠 때 판정을 LLM 쪽으로 옮기지 않는다. 판정 규칙을 바꾸려면 스크립트와 그 테스트를 고친다.

### 대상 저장소의 `.review/`

플러그인은 이 저장소가 아니라 **리뷰 대상 저장소**의 `.review/` 에 상태를 둔다: `rules.md`(`rules/default.md` 에서 복사), `findings.json`(원장), `decisions.md`, `config.json`. 스크립트는 `process.cwd()` 를 대상 저장소의 루트로 보고, 스킬은 `${CLAUDE_PLUGIN_ROOT}/scripts/...` 로 스크립트를 부른다.

### ledger.mjs

- 지적 ID 는 `F-` + `sha1(source|file|symbol)` 앞 8자다. 줄 번호가 들어가지 않으므로 코드가 밀려도 ID 가 유지된다. `source` 는 규칙 ID(`R-001`) 또는 자유 탐색의 분류에 `explore:` 를 붙인 것(`explore:bug`, `explore:security`, `explore:data-loss`, `explore:concurrency`).
- `apply` 가 한 번의 리뷰 결과(`rechecks`, `violations`, `candidates`)를 원장에 병합하며 상태를 옮긴다: `open` ↔ `resolved`(재발하면 다시 `open`), 확인되지 않은 후보는 `dismissed`, `intended`/`rejected` 로 결정된 지적이 다시 나오면 파일 해시(`decidedHash`)가 달라졌을 때만 `reopen-requested`.
- `decide` 는 결정을 `decisions.md` 에 한 줄 구조로 남긴다. 이유와 심볼은 셸이 해석하지 못하게 인자가 아니라 파일로 받는다(`--reason-file`, `ids <파일>`).

### fix.mjs

지적 하나의 수정을 상태 기계로 진행한다: `start` → `stage red` → `stage fixed` → `finish` 또는 `abort`. `ledger.mjs` 를 가져다 쓴다.

- `start` 는 설정의 검사를 실행해 기준선을 잡고, 설정·HEAD·파일 스냅숏을 상태 파일에 고정한다. 이후 단계는 이 고정된 값과 비교한다.
- 각 단계는 `{ ok, reasons, verdicts }` 를 돌려준다. `reasons` 의 문자열(`repro-not-failing`, `regression`, `tests-changed` 등)과 `level`(`reproduced` / `guarded` / `unverified`)은 `review-fix` 스킬의 표와 `anetos-process` 가 그대로 읽는 계약이다.
- 검사 명령은 내부 명령 `__run` 으로 감싸 실행해 제한 시간을 넘기면 프로세스 트리째 끝낸다. Windows(`cmd.exe`, `taskkill`)와 대소문자를 구분하지 않는 파일 시스템을 따로 다룬다.
- 커밋과 되돌리기는 `finish` 와 `abort` 만 한다. 커밋 메시지는 `fix(review): <제목> [<지적 ID>]`.

### anetos-process 가 anetos-review 에 묶이는 방식

mod 는 모델에게 묻지 않고 두 가지만 본다: `ledger.mjs`/`fix.mjs` 를 부르는 셸 명령 문자열과 그 JSON 출력, 그리고 `anetos-review:` 로 시작하는 서브에이전트의 시작·종료.

- `hooks/flow.ts`: 명령 문자열 해석(`parseCommands`), 출력에서 JSON 찾기(`parseJson`), 사건을 단계 상태로 접기(`reduce`). 엔진을 쓰지 않는 순수 함수.
- `hooks/draw.ts`, `hooks/sprites.ts`: SVG 와 글자 표현. 순수 함수.
- `hooks/register.tsx`: 엔진 이벤트 연결, atom, 화면. 엔진에 닿는 코드는 여기에만 둔다.

그래서 **스크립트의 하위 명령 이름, 인자 형태, 출력 JSON 의 모양을 바꾸면 `flow.ts` 도 함께 고쳐야 한다.** `tests/process-contract.test.mjs` 가 두 스크립트를 실제로 실행한 출력을 `flow.ts` 에 넣어 어긋남을 잡는다.

## 함께 바꿔야 하는 것

- `scripts/*.test.mjs` 의 `문서:` 로 시작하는 테스트는 `SKILL.md` 와 `agents/*.md` 에 특정 문구와 명령이 있는지 정규식으로 검사한다. 스킬·에이전트 문서의 표현을 바꾸면 이 테스트가 깨질 수 있다.
- 규칙 ID 는 바꾸거나 재사용하지 않는다. 없앨 때는 섹션을 지우지 않고 `- 상태: 폐기` 를 붙인다.
- `fixtures/sample-repo/` 의 코드에는 문제를 알려 주는 주석을 달지 않는다. 심은 문제와 측정 절차·결과는 바깥의 `fixtures/EXPECTED.md` 에 있다. fixture 를 바꾸면 이 표도 맞춘다.
- `fixtures/EXPECTED.md` 의 측정은 `claude -p` 로 실제 리뷰를 돌리는 수동 절차다. 자동 테스트가 아니며, 결과 표는 실제로 실행한 것만 적는다.

설계 배경과 결정의 이유는 `docs/superpowers/specs/` 에 있다.
