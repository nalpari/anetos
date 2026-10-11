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

`ok` 가 거짓이면 `reasons` 에 따라 한다.

| reasons | 할 일 |
|---|---|
| `regression`, `finding-present`, `nothing-fixed` | fixer 를 `mode: fix` 로 **한 번** 다시 띄운다. `reasons` 와, `verdicts` 중 `regressed` 인 항목의 `tail` 을 함께 넘긴다. 그 뒤 재확인과 `stage fixed` 를 다시 한다 |
| `tests-changed` | fixer 가 앞 단계의 테스트를 고쳤다. 원래 테스트를 되살릴 방법이 없으므로 다시 시도하지 않고 6단계로 간다 |

두 번째도 거짓이면 6단계로 간다.

`outOfScope` 에는 지적된 파일이 아닌데 수정 단계에서 바뀐 파일이 전부 들어온다. 다른 소스 파일뿐 아니라, 수정 단계에서 손댄 기존 테스트 파일과 새로 만든 테스트 파일도 포함된다. 기존 테스트를 고쳐서 통과시킨 것일 수 있으므로 5단계에서 사용자가 본다.

### 5. 마무리

`stage fixed` 의 결과에 따라 한다.

- `outOfScope` 가 비어 있지 않으면: 그 파일들의 변경 내용과 fixer 의 `note` 를 사용자에게 보여 주고 함께 커밋할지 묻는다. 새로 생긴 파일은 diff 에 나오지 않으므로 파일을 읽어 내용을 보여 준다.
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

`finish` 는 `stage fixed` 가 확인한 내용과 지금의 파일이 다르면 거부한다. `stage fixed` 가 통과한 뒤에는 파일을 건드리지 않는다. 이 오류가 나면 재확인과 `stage fixed` 를 한 번 다시 한 뒤 `finish` 한다.

`.review/` 에서는 원장(`findings.json`)만 커밋에 들어간다. 사용자가 커밋하지 않은 규칙이나 설정 변경은 그대로 남는다.

커밋 훅 실패 등으로 `finish` 가 실패하면 오류를 그대로 전하고 멈춘다. 작업 트리에 수정이 남아 있으니, 원인을 해결한 뒤 `finish` 를 다시 실행하거나 `abort` 하라고 안내한다. 훅을 건너뛰는 방법을 쓰지 않는다.

### 6. 중단

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" abort
```

작업 트리가 시작 시점으로 돌아간다. 다만 결과의 `unrestored` 에 파일이 있으면, 그것은 시작 전부터 있던 미추적 파일을 수정이 바꾼 것이다. git 에 원본이 없어 되돌리지 못했으므로 어떤 파일인지 반드시 알린다.

사용자에게 다음을 알린다.
- 어느 단계에서 왜 멈췄는지 (`reasons`, 실패한 검사의 이름과 출력 끝부분)
- 지적은 `open` 그대로이고 시도 횟수가 기록됐다는 것
- 처리하지 않은 나머지 ID

중단한 지적을 다른 방법으로 다시 시도하지 않는다.

## 하지 않는 것

- `.review/` 아래의 파일을 직접 편집하지 않는다.
- `git commit`, `git checkout`, `git reset`, `git stash` 를 직접 실행하지 않는다. 커밋과 되돌리기는 `finish` 와 `abort` 가 한다.
- 검사를 통과시키려고 설정의 검사를 빼거나 명령을 바꾸지 않는다.
