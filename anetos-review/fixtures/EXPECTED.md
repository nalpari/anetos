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
| 2026-10-11 | Claude Code 2.1.296 headless(`claude -p`) 기본 모델, 모델명 미확인 | 5/5 | 0 | 0 | 0 | 0 | 3/3 | 회차마다 새 프로세스. dismissed 0건. R-007 지적은 2·3회차 모두 "재검토 요청"으로만 나옴. 한 번의 측정이라 변동 폭은 알 수 없음 |
| 2026-10-11 | 위와 같음 | (4회차만 추가 실행) | 0 | — | 4회차 신규 0 | 0 | — | 결정 고정(`decidedHash`) 추가 후 확인. R-007 지적을 `keep` 한 뒤 다시 리뷰하니 `intended` 로 유지되고 "기존 결정 유지 1건"으로만 보고됨. 재검토 요청 0건, 결정 기록 추가 없음 |

결정 고정을 넣은 뒤로는 파일이 그대로인 한 재검토 요청이 생기지 않는다. 측정 절차 4번에서 결정을 기록한 뒤 2·3회차에 R-007 지적이 "재검토 요청"에 나오면 그것도 실패로 본다.
