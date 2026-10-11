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
| src/cart.js | totalPrice (또는 portion) | 퍼센트 할인을 100 이 아니라 10 으로 나눔. 계산은 공용 도우미 `portion` 을 거친다 |
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
| 2026-10-11 | Claude Code 2.1.296 headless(`claude -p`) 기본 모델, 모델명 미확인 | 5/5 | 0 | 0 | 0 | 0 | 3/3 | 회차마다 새 프로세스. dismissed 0건. R-007 지적은 2·3회차 모두 "재검토 요청"으로만 나옴. 한 번의 측정이라 변동 폭은 알 수 없음 |
| 2026-10-11 | 위와 같음 | (4회차만 추가 실행) | 0 | — | 4회차 신규 0 | 0 | — | 결정 고정(`decidedHash`) 추가 후 확인. R-007 지적을 `keep` 한 뒤 다시 리뷰하니 `intended` 로 유지되고 "기존 결정 유지 1건"으로만 보고됨. 재검토 요청 0건, 결정 기록 추가 없음 |

결정 고정을 넣은 뒤로는 파일이 그대로인 한 재검토 요청이 생기지 않는다. 측정 절차 4번에서 결정을 기록한 뒤 2·3회차에 R-007 지적이 "재검토 요청"에 나오면 그것도 실패로 본다.

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
| 2026-10-11 | Claude Code 2.1.296 headless(`claude -p`) 기본 모델, 모델명 미확인 | 0 | 0 | 충족 | (b) | 0 (신규 지적 0건) | 8/8 | 7 / 1 | 지적 하나당 62~102초. 중단·재시도·flaky 0건. 함정 1은 fixer 가 처음부터 `portion` 을 건드리지 않고 `totalPrice` 에서 고쳐, 회귀가 잡혀 되돌려지는 경로는 실제 실행에서 일어나지 않았다(단위 테스트로만 확인됨). 함정 2는 입력을 이스케이프해 한 파일 안에서 고쳤다. guarded 1건은 하드코딩된 키(R-002). 수정 후 테스트는 2개에서 19개로 늘었다. 한 번의 측정이라 변동 폭은 알 수 없음 |
| 2026-10-11 | 위와 같음 | 0 | 0 | 충족 | — | — | 2/2 (부분 재실행) | 1 / 1 | 최종 리뷰에서 나온 결함을 고친 뒤(검사 실행 방식과 변경 파일 판정이 바뀜) 실제 흐름이 여전히 동작하는지 확인하려고 `totalPrice` 와 하드코딩된 키 두 건만 다시 실행. 8건 전체를 다시 측정하지는 않았다 |
