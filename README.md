# anetos

실행할수록 결과가 수렴하는 코드 리뷰를 위한 Claude Code 플러그인 모음.

같은 코드를 LLM 에게 여러 번 리뷰시키면 매번 다른 지적이 나오고, 이미 "의도된 설계"라고 답한 것을 다시 묻는다. anetos 는 판단은 서브에이전트에게 맡기되, **무엇이 같은 지적인지, 결정과 충돌하는지, 수정이 통과했는지**는 스크립트가 판정하게 해서 이 문제를 줄인다.

| 플러그인 | 하는 일 |
|---|---|
| [`anetos-review`](anetos-review) | 고정 규칙 검사와 결정 기록으로 수렴하는 코드 리뷰, 그리고 회귀가 없을 때만 커밋하는 수정 |
| [`anetos-process`](anetos-process) | `anetos-review` 의 진행 상황을 프롬프트 위 진행 바와 에이전트 패널로 보여 주는 mod |

## 설치

```
/plugin marketplace add nalpari/anetos
/plugin install anetos-review@anetos
/plugin install anetos-process@anetos
```

`anetos-process` 는 선택이다. `anetos-review` 없이 설치하면 아무것도 표시하지 않는다.

저장소를 받아 바로 불러오려면:

```bash
claude --plugin-dir ./anetos-review --plugin-dir ./anetos-process
```

필요한 것: Claude Code, Node.js, git. 스크립트는 Node 표준 라이브러리만 쓰므로 `npm install` 이 없다.

## 사용법

모든 명령은 리뷰할 저장소의 루트에서 실행한다.

### 1. 리뷰

```
/anetos-review:review            기준 브랜치(main, 없으면 master) 대비 변경된 파일
/anetos-review:review src        경로를 지정
```

처음 실행하면 대상 저장소에 `.review/` 가 생긴다. 결과는 신규 / 여전히 열려 있음 / 해결됨 / 재발 / 재검토 요청의 다섯 묶음으로 보고된다. 리뷰는 코드를 고치지 않고 커밋도 하지 않는다. `.review/` 의 변경은 코드와 함께 직접 커밋한다.

### 2. 결정 기록

지적이 의도된 설계이거나 틀렸으면 이유와 함께 기록한다. 그 파일이 바뀌지 않는 한 다시 묻지 않는다.

```
/anetos-review:review-decide <지적 ID> intended "이유"    의도된 설계
/anetos-review:review-decide <지적 ID> rejected "이유"    지적이 틀림
/anetos-review:review-decide <지적 ID> reopen "이유"      결정을 뒤집고 다시 연다
/anetos-review:review-decide <지적 ID> keep "이유"        기존 결정을 유지한다
```

결정한 뒤 파일이 바뀌었고 같은 지적이 다시 나오면 "재검토 요청"으로 올라온다. 그때 `reopen` 이나 `keep` 으로 답한다.

### 3. 검증 설정

수정을 검증할 명령(테스트, 타입체크, 린트, 빌드)과 테스트 파일 경로를 정한다. 후보를 찾아 보여 주고, 확정한 것만 `.review/config.json` 에 저장한다.

```
/anetos-review:review-config
```

### 4. 수정

```
/anetos-review:review-fix <지적 ID> [<지적 ID>...]
```

지적 하나를 세 단계로 고친다.

1. **기준선**: 고치기 전에 검사를 실행해 둔다. 이미 실패하고 있는 검사는 "가려진 검사"로 알린다.
2. **빨강**: 재현 테스트를 먼저 쓰고, 그 테스트가 실제로 실패하는지 확인한다.
3. **초록**: 고친 뒤 기준선 대비 회귀가 없고 지적이 사라졌는지 확인한다.

통과하면 `fix(review): <제목> [<지적 ID>]` 로 커밋하고, 아니면 작업 트리를 시작 시점으로 되돌린다. 수정마다 검증 수준이 원장에 기록된다.

| 수준 | 뜻 |
|---|---|
| `reproduced` | 재현 테스트가 수정 전에 실패하고 수정 후에 통과했다 |
| `guarded` | 재현 테스트는 없고, 기존 검사가 수정 후에도 통과했다 |
| `unverified` | 확인해 줄 검사가 없었고 사용자가 승인했다 |

지적된 파일 밖을 건드린 수정과 `unverified` 수정은 사용자가 승인해야 커밋된다. 커밋하지 않은 변경이 `.review/` 밖에 있으면 시작하지 않는다.

## 동작 방식

### 리뷰

```
범위 확정 → 기존 지적 재확인 → 규칙 검사 → 자유 탐색 → 후보 검증 → 원장 갱신 → 보고
             verifier          rule-checker   explorer    verifier     ledger.mjs
```

| 에이전트 | 맡은 일 | 도구 |
|---|---|---|
| `rule-checker` | 규칙마다 `violation` / `pass` / `n/a` 를 판정한다. 규칙에 없는 문제는 보고하지 않는다 | 읽기 전용 |
| `explorer` | 규칙이 다루지 않는 버그·보안·데이터 손실·동시성 문제의 후보를 낸다 | 읽기 전용 |
| `verifier` | 후보의 주장만 받아 코드에 비추어 독립적으로 검증한다. 기존 지적이 남아 있는지도 확인한다 | 읽기 전용 |
| `fixer` | 지적 하나에 대해 테스트를 쓰거나 그 문제만 고친다. 명령은 실행할 수 없다 | 읽기, 쓰기 |

수렴을 만드는 장치:

- **고정 규칙**: 같은 규칙 목록을 순서대로 적용한다. 규칙 ID 는 바꾸거나 재사용하지 않는다.
- **안정적인 지적 ID**: `F-` + `sha1(출처|파일|심볼)` 의 앞 8자. 줄 번호가 밀려도 같은 지적은 같은 ID 다.
- **독립 검증**: 자유 탐색의 후보는 주장과 코드만으로 다시 검증하고, 확인되지 않으면 `dismissed` 로 남겨 다음에 다시 올라오지 않게 한다.
- **결정 고정**: 결정할 때의 파일 해시를 기록해, 파일이 그대로면 재검토를 요청하지 않는다.

### `.review/` (대상 저장소에 생기는 것)

| 파일 | 내용 |
|---|---|
| `rules.md` | 리뷰 규칙. 기본 10개(R-001~R-010)에서 시작하며 프로젝트에 맞게 고친다. 고유 규칙은 R-100부터 |
| `findings.json` | 원장. 지적과 상태(`open`, `resolved`, `dismissed`, `intended`, `rejected`, `reopen-requested`) |
| `decisions.md` | 결정과 이유의 기록 |
| `config.json` | 수정을 검증할 명령과 테스트 경로 |

`rules.md` 외에는 직접 편집하지 않는다. 스킬이 `ledger.mjs` 와 `fix.mjs` 로 다룬다.

기본 규칙이 다루는 것: 검증 없는 외부 입력, 코드·로그의 비밀 값, 삼켜진 오류, 확인하지 않은 호출 결과, 해제되지 않는 자원, 확인-변경 사이의 경쟁, 제한 시간 없는 외부 호출, 경계값, 인증·권한 누락, 확인 없는 파괴적 동작. 전문은 [rules/default.md](anetos-review/rules/default.md).

## 저장소 구조

```
.claude-plugin/marketplace.json   마켓플레이스 정의
anetos-review/
  skills/      review, review-decide, review-config, review-fix
  agents/      rule-checker, explorer, verifier, fixer
  scripts/     ledger.mjs (원장), fix.mjs (수정 검증), 각각의 테스트
  rules/       default.md (기본 규칙)
  fixtures/    문제를 심어 둔 sample-repo 와 측정 결과(EXPECTED.md)
anetos-process/
  hooks/       flow.ts (명령 해석), sprites.ts, draw.ts, register.tsx (화면)
  tests/       mod 테스트
tests/         두 플러그인 사이의 대조 테스트
docs/          설계 스펙과 구현 계획
```

## 개발

스크립트 테스트:

```bash
node --test anetos-review/scripts/*.test.mjs
```

`anetos-process` 가 `anetos-review` 스크립트의 출력을 여전히 올바로 해석하는지 보는 대조 테스트:

```bash
node --experimental-strip-types --test tests/process-contract.test.mjs
```

mod 검증과 테스트:

```bash
claude plugin validate anetos-process
```

```bash
claude plugin test anetos-process
```

수렴과 수정의 측정 절차와 결과는 [fixtures/EXPECTED.md](anetos-review/fixtures/EXPECTED.md), mod 의 세부는 [anetos-process/README.md](anetos-process/README.md), 설계 배경은 [docs/superpowers/specs](docs/superpowers/specs) 에 있다.

## 라이선스

MIT (`anetos-process` 의 `plugin.json` 기준)
