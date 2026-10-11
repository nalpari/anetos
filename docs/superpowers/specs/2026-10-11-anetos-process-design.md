# anetos-process 설계: anetos-review의 진행 상황을 보여 주는 mod

- 작성일: 2026-10-11
- 상태: 검토 대기
- 관련: `2026-10-11-anetos-review-phase1-design.md`, `2026-10-11-anetos-review-phase2-design.md`
- 참고한 mod: `savvy-progress` (https://github.com/JohnnyVizz/claude-kit). 구조와 이벤트 사용법을 참고했고, 코드와 그림은 가져오지 않는다.

## 1. 배경과 목표

`/anetos-review:review`와 `/anetos-review:review-fix`는 서브에이전트를 여러 개 띄우고 스크립트를 여러 번 호출한다. 실행하는 동안 지금 어느 단계인지, 어떤 에이전트가 무엇을 하고 있는지는 대화 기록을 따라 읽어야만 알 수 있다.

`anetos-process`는 이것을 화면에 보여 주는 mod다.

1. 프롬프트 위에 진행 바를 둔다. 흐름의 종류, 지금 단계, 전체 중 몇 단계가 끝났는지를 한 줄로 보여 준다.
2. 패널에 단계 목록과 에이전트 목록을 보여 준다.
3. 에이전트는 역할에 맞는 픽셀 캐릭터로 그리고, 일하는 동안 움직인다.

**원칙: 모델에게 묻지 않는다.** 진행 상황은 엔진의 이벤트와 스크립트의 출력에서만 읽는다. 모델이 호출하는 보고용 도구를 등록하지 않으므로, 모델이 보고를 잊어서 표시가 틀리는 일이 없다. anetos-review의 스킬과 에이전트 문서는 고치지 않는다.

## 2. 범위

**포함**
- 진행 바(프롬프트 위), 패널, 패널을 여닫는 `/anetos-process` 명령
- 리뷰 흐름과 수정 흐름의 단계 인식
- anetos-review의 에이전트 네 종류(rule-checker, explorer, verifier, fixer)의 추적
- 픽셀 캐릭터 네 종과 애니메이션(데스크톱), 같은 정보를 글자로 보여 주는 터미널 표시
- 저장소 최상위의 `.claude-plugin/marketplace.json`: 두 플러그인을 설치할 수 있게 한다

**제외**
- anetos-review가 아닌 서브에이전트의 추적. savvy-progress가 이미 하고 있어 겹친다.
- 비용 표시. 엔진이 주는 것은 토큰 수뿐이고, 금액은 가격표를 넣어 추정해야 한다. 토큰과 시간만 보여 준다.
- 모델이 호출하는 도구 등록
- 언어 설정. 표시 문구는 한국어만 쓴다.
- 지난 흐름의 기록 보관. 세션 안에서 가장 최근 흐름 하나만 보여 준다.

## 3. 구성

```
anetos/
├─ .claude-plugin/marketplace.json     # 신규. anetos-review 와 anetos-process 를 나열
├─ anetos-review/                      # 변경 없음
└─ anetos-process/
   ├─ .claude-plugin/plugin.json
   ├─ hooks/
   │  ├─ hooks.json                    # { "modules": ["./register.tsx"] }
   │  ├─ register.tsx                  # 이벤트 연결과 그리기
   │  ├─ flow.ts                       # 명령 해석, 단계 계산 (순수 함수)
   │  ├─ sprites.ts                    # 캐릭터 SVG 생성 (순수 함수)
   │  ├─ flow.test.ts
   │  ├─ sprites.test.ts
   │  └─ register.test.ts
   ├─ types/index.d.ts                 # 상태 형식 계약
   └─ README.md
```

- `flow.ts`와 `sprites.ts`는 엔진(`$`)을 쓰지 않는 순수 함수만 둔다. 화면 없이 테스트할 수 있어야 한다.
- 개발은 Claude Code가 mod용으로 주는 세션 폴더에서 해서 바로 불러와 보고, 완성되면 저장소의 `anetos-process/`로 복사해 커밋한다.
- anetos-review를 의존성으로 선언하지 않는다. anetos-review 없이 설치해도 오류 없이 아무것도 표시하지 않을 뿐이다.

## 4. 진행 상황을 아는 방법

mod는 세 가지 이벤트를 본다.

| 이벤트 | 읽는 것 |
|---|---|
| `tool.call` (Bash, PowerShell) | 명령에 `ledger.mjs`나 `fix.mjs`가 있으면 하위 명령과 인자, 그리고 실행 결과의 JSON |
| `agent.spawn` | 에이전트 종류가 `anetos-review:`로 시작하면 종류와, 넘겨받은 요청의 `mode:` |
| `turn.step`, `turn.complete` | 그 에이전트의 모델, 토큰, 종료 여부 |

`tool.call`에서는 항상 원래 호출을 그대로 실행하고 그 결과를 그대로 돌려준다. mod는 호출을 막거나 바꾸지 않는다. mod 안에서 오류가 나도 도구 호출의 결과에는 영향이 없어야 한다.

### 4.1 명령 인식

명령 문자열에서 `(ledger|fix).mjs` 뒤의 하위 명령을 찾는다. 스킬은 `node "${CLAUDE_PLUGIN_ROOT}/scripts/fix.mjs" stage red --repro yes` 형태로 쓰지만, 경로와 따옴표가 달라도 파일 이름과 하위 명령만 맞으면 인식한다.

결과는 표준 출력에서 첫 JSON 값을 찾아 해석한다. 해석하지 못하면 명령이 실행됐다는 사실만 반영하고 결과는 "알 수 없음"으로 둔다.

한 번의 호출에 스크립트 명령이 둘 이상 들어 있으면 출력이 섞이므로, 명령이 실행됐다는 사실만 반영하고 결과는 읽지 않는다.

### 4.2 리뷰 흐름

| 단계 | 시작으로 보는 것 | 끝으로 보는 것 |
|---|---|---|
| 불러오기 | `ledger.mjs init` (**흐름 시작**) | 다음 단계가 시작됨 |
| 기존 지적 재확인 | verifier가 `mode: recheck`로 시작 | 그 에이전트들이 모두 끝남 |
| 규칙 검사 | rule-checker 시작 | 모두 끝남 |
| 자유 탐색 | explorer 시작 | 끝남 |
| 후보 검증 | verifier가 `mode: candidate`로 시작 | 모두 끝남 |
| 원장 갱신 | `ledger.mjs apply` 실행 | 그 결과 (**흐름 종료**) |

- `apply`의 결과(`new`, `stillOpen`, `resolved`, `recurred`, `reopenRequested`, `decided`, `dismissed`의 건수)를 흐름의 결과로 보여 준다.
- `apply`가 실패하면(종료 코드가 0이 아님) "원장 갱신" 단계를 실패로 표시하고 흐름을 열어 둔다. 스킬이 고쳐서 다시 실행하면 그 결과로 갱신한다.
- 진행 중인 흐름이 없는데 rule-checker나 explorer가 시작되면 리뷰 흐름을 시작한 것으로 본다. `init`을 놓친 경우의 안전망이다.
- 흐름이 끝났을 때 한 번도 시작되지 않은 단계는 "건너뜀"이 된다. 기존 지적이 없어서 재확인이 없었던 경우 등이다.

### 4.3 수정 흐름

| 단계 | 시작으로 보는 것 | 끝으로 보는 것 |
|---|---|---|
| 기준선 | `fix.mjs start <ID>` 실행 (**흐름 시작**) | 그 결과. `masked`가 있으면 단계에 적는다 |
| 테스트 작성 | fixer가 `mode: tests`로 시작 | 끝남 |
| 빨강 확인 | `fix.mjs stage red` 실행 | 결과의 `ok` |
| 수정 | fixer가 `mode: fix`로 시작 | 끝남 |
| 지적 재확인 | verifier가 `mode: recheck`로 시작 | 끝남 |
| 초록 확인 | `fix.mjs stage fixed` 실행 | 결과의 `ok`, `level`, `outOfScope` |
| 커밋 | `fix.mjs finish` 실행 | 그 결과 (**흐름 종료: 커밋됨**) |

- `fix.mjs abort`는 어느 단계에서든 흐름을 "중단됨"으로 끝낸다. 남은 단계는 건너뜀이 된다.
- `stage red`나 `stage fixed`의 결과가 `ok: false`이면 그 단계를 "재시도"로 표시하고, 시도 횟수와 `reasons`를 적는다. 이후 같은 명령이 다시 실행되어 통과하면 완료가 된다.
- `start`가 실패하면(전제 조건 위반) 흐름을 시작하지 않고, 오류 메시지를 토스트로 한 번 알린다.
- `finish`가 실패하면 "커밋" 단계를 실패로 표시하고 흐름을 열어 둔다.
- 수정 흐름 중에 `ledger.mjs list`의 결과에 해당 ID가 있으면 그 지적의 제목을 읽어 흐름의 제목에 붙인다.
- `review-fix`에 ID를 여러 개 주면 `start`마다 새 흐름이 된다. 이전 흐름은 새 흐름으로 바뀐다.

### 4.4 에이전트

`agent.spawn`에서 종류가 `anetos-review:rule-checker`, `explorer`, `verifier`, `fixer` 중 하나면 목록에 추가한다.

| 종류 | `mode` | 화면에 쓰는 "하는 일" |
|---|---|---|
| rule-checker | — | 규칙 검사 |
| explorer | — | 자유 탐색 |
| verifier | `recheck` | 지적 재확인 |
| verifier | `candidate` | 후보 검증 |
| fixer | `tests` | 테스트 작성 |
| fixer | `fix` | 수정 |

- `mode`는 넘겨받은 요청에서 `mode: <값>`을 찾아 읽는다. 찾지 못하면 종류 이름만 쓴다.
- `turn.step`마다 모델, 누적 토큰, 컨텍스트 크기를 갱신한다.
- `turn.complete`에서 정상 종료면 완료, 그 외에는 실패로 표시한다.
- 새 흐름이 시작되면 이전 흐름의 끝난 에이전트는 목록에서 지운다. 아직 실행 중인 에이전트는 남긴다.
- 목록은 최근 100개까지만 둔다.

## 5. 상태

`$.state`에 두고 `types/index.d.ts`에 계약으로 선언한다. 모듈 변수에는 두지 않는다(다시 불러올 때 사라진다).

```ts
type StageStatus = 'pending' | 'running' | 'retry' | 'done' | 'failed' | 'skipped'

type Stage = {
  key: string          // 'load', 'recheck', 'rules', 'explore', 'verify', 'apply',
                       // 'baseline', 'tests', 'red', 'fix', 'recheck', 'green', 'commit'
  label: string        // 화면에 쓰는 이름
  status: StageStatus
  tries: number        // 판정 단계의 시도 횟수
  note: string         // 한 줄 결과: "가려진 검사: lint", "repro-not-failing", "reproduced" 등
}

type Flow = {
  kind: 'review' | 'fix'
  title: string        // "리뷰" 또는 "수정 F-xxxxxxxx"
  detail: string       // 수정이면 지적의 제목
  stages: Stage[]
  outcome: 'running' | 'done' | 'committed' | 'aborted'
  summary: string      // 흐름이 끝났을 때의 한 줄 결과
  startedAt: number
  endedAt?: number
}

type AgentRun = {
  id: string
  agentId?: string
  role: 'rule-checker' | 'explorer' | 'verifier' | 'fixer'
  mode: string         // '', 'recheck', 'candidate', 'tests', 'fix'
  description: string  // Agent 도구의 description
  model: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  tokens: number
  contextTokens: number
}

// PluginState['anetos-process']
{ flow: Flow | null; agents: AgentRun[]; panel: { isDoneCollapsed: boolean; autoOpenedFor: string }; now: number }
```

단계 계산은 `flow.ts`의 순수 함수로 한다. 입력은 지금의 흐름과 사건 하나(명령과 그 결과, 에이전트 시작, 에이전트 종료)이고 출력은 새 흐름이다. `register.tsx`는 이벤트를 사건으로 바꿔 이 함수에 넘기고 결과를 상태에 쓴다.

진행률은 `완료 + 건너뜀`인 단계 수를 전체 단계 수로 나눈 값이다.

## 6. 화면

### 6.1 진행 바 (프롬프트 위)

흐름이 있을 때만 그린다. 흐름이 없으면 엔진이 그리던 것을 그대로 둔다.

```
● 리뷰            ████████░░░░  규칙 검사 · 자유 탐색   3/6   [에이전트 2]  [✕]
● 수정 F-c6e90533  ██████░░░░░░  빨강 확인 (재시도 2)    2/7   [에이전트 0]  [✕]
✓ 수정 F-c6e90533  ████████████  커밋됨 · reproduced     7/7   [에이전트 3]  [✕]
```

- 가운데 글자는 지금 진행 중인 단계들이다. 흐름이 끝났으면 결과를 쓴다.
- `[에이전트 N]`은 패널을 여닫는 버튼이고, `[✕]`는 진행 바를 치운다(흐름 상태를 비운다).
- 데스크톱에서는 제목, 바, 단계 글자, 진행률을 SVG 하나로 그리고, 지금 일하는 에이전트의 캐릭터를 끝에 작게 넣는다. 버튼 두 개만 그 옆의 별도 요소다. 데스크톱은 나란한 요소를 다음 줄로 넘기기 때문에 한 줄을 그림 하나로 그려야 한다.
- 터미널에서는 같은 내용을 글자로 그린다.
- 색: 진행 중은 클레이, 완료는 초록, 중단·실패는 빨강.

### 6.2 패널

`/anetos-process`로 여닫는다. 흐름이 시작될 때 흐름마다 한 번 자동으로 연다. 사용자가 닫으면 그 흐름에서는 다시 열지 않는다.

위에서부터:

1. **머리**: 흐름의 제목과 세부, 걸린 시간, 토큰 합계
2. **단계 목록**: 단계마다 상태 표시(대기 ○, 진행 중 ●, 재시도 ↻, 완료 ✓, 실패 ✗, 건너뜀 –)와 이름, 한 줄 결과
3. **에이전트 목록**: 실행 중인 것이 위, 끝난 것은 접을 수 있는 묶음
4. **결과**: 흐름이 끝났으면 요약 한 줄

에이전트 한 줄에는 캐릭터, 하는 일, Agent 도구의 description, 모델, 걸린 시간, 토큰, 상태가 들어간다. 데스크톱에서는 줄마다 SVG 하나로 그린다. 터미널에서는 색 있는 기호와 글자로 그린다.

흐름도 에이전트도 없으면 "아직 실행된 리뷰가 없습니다."를 보여 준다.

### 6.3 캐릭터

공통 몸통은 클레이 색의 네모난 몸, 두 눈, 양옆의 짧은 팔, 다리 네 개다. Claude Code 마스코트의 인상을 따르되 새로 그린다. 역할은 모자와 소품으로 구분한다.

| 에이전트 | 캐릭터 | 소품 | 움직임 |
|---|---|---|---|
| rule-checker | 규칙 검사관 | 초록 챙모자, 클립보드 | 체크 표시가 위에서부터 하나씩 채워진다 |
| explorer | 탐험가 | 탐험 모자, 손전등 | 불빛이 좌우로 훑는다 |
| verifier | 검증관 | 외알 안경, 도장 | 도장이 내려찍히고 종이에 붉은 인장이 남는다 |
| fixer | 수리공 | 안전모, 망치 | 망치를 내리치면 불꽃이 튄다 |

- 실행 중: 몸이 들썩이고, 다리가 번갈아 움직이고, 가끔 눈을 깜빡이며, 소품이 움직인다.
- 완료: 멈춘 채 초록 체크 배지.
- 실패: 회색 몸에 빨간 배지.
- 애니메이션은 SVG 안의 CSS로 한다. `prefers-reduced-motion`이 켜져 있으면 모두 멈춘다.
- 그림은 30×18칸 격자에 사각형으로 찍는다. `sprites.ts`의 함수가 역할, 상태, 한 칸의 크기를 받아 SVG 조각을 돌려준다.
- 캐릭터는 데스크톱에서만 보인다. 터미널에는 SVG 요소가 없다.

## 7. 명령과 그 밖의 동작

- `/anetos-process`: 패널을 열거나 닫는다. 결과로 "패널을 열었습니다." 또는 "패널을 닫았습니다."를 돌려준다.
- 실행 중인 에이전트가 있는 동안만 1초마다 시각을 갱신해 걸린 시간이 움직이게 한다. 아무것도 실행 중이 아니면 갱신하지 않는다.

## 8. 견고함

- mod의 어떤 실패도 도구 호출, 에이전트 실행, 화면의 다른 부분을 막지 않는다. 인식하지 못한 명령과 해석하지 못한 출력은 조용히 무시한다.
- 스크립트의 출력 형식에 의존한다. `ledger.mjs`나 `fix.mjs`의 출력이 바뀌면 mod의 해석이 어긋난다. 같은 저장소에 있으므로, 실제 스크립트의 출력을 입력으로 쓰는 테스트를 둬서 어긋남을 잡는다(9절).
- 모르는 필드는 무시하고, 기대한 필드가 없으면 그 정보만 비운다. 스크립트가 필드를 추가해도 깨지지 않아야 한다.
- 흐름이 끝나지 않은 채 대화가 끊기면 진행 바가 "진행 중"으로 남는다. `[✕]`로 치울 수 있고, 다음 흐름이 시작되면 바뀐다.

## 9. 검증

**단위 테스트 (`claude plugin test anetos-process`)**

`flow.test.ts`
- 명령 인식: 스킬이 쓰는 형태, 경로와 따옴표가 다른 형태, PowerShell 형태, 한 호출에 명령이 둘인 경우, 스크립트와 무관한 명령.
- 리뷰 흐름: 사건을 순서대로 넣었을 때 단계 상태가 4.2대로 바뀌는 것. 동시에 도는 단계, 건너뛴 단계, `apply` 실패 뒤 재실행.
- 수정 흐름: 4.3대로 바뀌는 것. 재시도, 중단, `start` 실패, `finish` 실패, ID 여러 개.
- 결과 해석: JSON이 없거나 깨진 출력, 모르는 필드가 있는 출력.
- **실제 출력과의 대조**: `anetos-review/scripts/ledger.mjs`와 `fix.mjs`를 임시 저장소에서 실제로 실행해 얻은 출력을 그대로 해석해 본다. 스크립트의 출력 형식이 바뀌면 이 테스트가 실패해야 한다.

`sprites.test.ts`
- 네 역할과 네 상태의 모든 조합이 SVG 조각을 돌려주고, 엔진이 정한 SVG 길이 제한 안에 든다.
- 실행 중이 아닌 상태에서는 애니메이션이 꺼져 있다.

`register.test.ts`
- 이벤트를 흘려 넣은 뒤 진행 바와 패널을 `terminal`과 `desktop` 두 표면에서 그려 보고, 단계 이름과 에이전트가 들어 있는지 확인한다.
- 도구 호출의 결과가 mod를 거쳐도 그대로인지 확인한다.
- `/anetos-process`가 패널을 여닫는지 확인한다.

**정적 검사**: `claude plugin validate anetos-process`와 타입 검사를 통과한다.

**실제 확인**: fixture 저장소에서 `/anetos-review:review`와 `/anetos-review:review-fix`를 한 번씩 실행해 진행 바와 패널이 실제 진행과 맞게 움직이는지 본다. 이 확인은 화면을 봐야 하므로 사용자가 이 세션에서 직접 보거나, 화면을 볼 수 없는 실행에서는 상태 값을 기록해 대조한다.

## 10. 미결 사항과 알려진 한계

- **PowerShell 도구의 결과 형태.** Bash 도구의 결과에는 `stdout`이 있다. PowerShell 도구의 결과도 같은 형태인지는 구현하면서 확인한다. 다르면 모델이 읽는 글자(`text`)에서 JSON을 찾는다.
- **실제 크기에서의 캐릭터.** 패널에서는 한 칸이 2픽셀 정도라 소품의 세부가 덜 보인다. 실제 크기로 보고 다듬는다.
- **리뷰의 시작을 `init`으로 잡는다.** 범위가 비어 리뷰가 그 전에 끝나면 아무것도 표시되지 않는다.
- **모델이 스크립트를 전혀 다른 방식으로 실행하면 놓친다.** 예를 들어 명령을 파일에 써서 실행하는 경우다. 에이전트 추적은 그래도 동작한다.
- **브랜드.** 캐릭터가 Claude Code 마스코트를 연상시킨다. 공개 저장소에 올라가면 Anthropic의 브랜드 자산을 변형해 쓴 것으로 보일 수 있다.
- **마켓플레이스 구성.** 1차 스펙에서 미뤄 둔 결정이다. 이 설계는 저장소 최상위에 `marketplace.json`을 두고 두 플러그인을 상대 경로로 나열한다.

## 11. 구현하면서 달라진 것 (2026-10-11)

- **실제 출력과의 대조 테스트의 위치.** mod 의 테스트(`claude plugin test`)는 파일과 프로세스에 접근할 수 없는 환경에서 돈다. 그래서 스크립트를 실제로 실행하는 대조 테스트는 mod 안이 아니라 저장소의 `tests/process-contract.test.mjs` 에 Node 테스트로 둔다.
- **파일 구성.** 데스크톱용 SVG 와 글자 다듬기를 `hooks/draw.ts` 로 따로 뒀다. 테스트는 `tests/` 폴더에 둔다.
- **표면 구분.** 터미널의 요소 표에도 `Svg` 라는 이름이 있지만 아무것도 그리지 않는다. 요소가 있는지가 아니라 표면이 터미널인지로 그림과 글자를 가른다.
- **PowerShell 도구.** 결과 형태가 Bash 와 같다(`stdout`, `stderr`). 미결 사항에서 지운다.
- **수정 흐름의 앞 단계 건너뜀.** 수정 흐름은 순서대로만 가므로, 뒤 단계가 움직였는데 아직 대기인 앞 단계는 그때 건너뜀으로 바꾼다. 리뷰 흐름은 단계가 동시에 돌 수 있어서 흐름이 끝날 때만 건너뜀으로 바꾼다.
- **지적 제목.** 수정 흐름의 제목 옆에 붙는 지적 제목은 스킬이 `ledger.mjs list` 를 단독으로 실행해 JSON 배열이 그대로 출력될 때만 읽힌다. 실제 실행 한 번에서는 읽히지 않았다(모델이 출력을 다른 명령으로 넘긴 것으로 보인다). 없어도 `수정 F-xxxx` 는 표시된다.
