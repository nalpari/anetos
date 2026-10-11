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
  git diff --name-only --diff-filter=d HEAD
  git ls-files --others --exclude-standard
  ```

  세 결과를 합친다. 커밋된 변경, 스테이징했거나 아직 스테이징하지 않은 변경, 새로 만든 미추적 파일을 모두 본다.
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

범위 밖이라도 파일이 사라진 지적은 여기서 정리한다. 삭제되거나 이름이 바뀐 파일은 범위에 들어오지 않으므로, 그대로 두면 그 지적이 영원히 열려 있게 된다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" list --status open
```

결과 중 `file` 이 저장소에 더 이상 없는 지적은 verifier 를 띄우지 않고 `rechecks` 에 `{ id, verdict: "absent", evidence: "" }` 로 넣는다. 파일이 있는 범위 밖 지적은 건드리지 않는다.

## 4. 규칙 검사

규칙마다 `- 적용:` glob 에 맞는 범위 파일을 고른다. 맞는 파일이 없는 규칙은 건너뛴다.

- 범위 파일이 10개 이하이면 `anetos-review:rule-checker` 하나를 띄운다.
- 10개를 넘으면 디렉터리가 같은 파일끼리 묶어 10개 이하의 묶음으로 나누고, 묶음마다 하나씩 병렬로 띄운다.

넘기는 내용: 적용되는 규칙의 ID·제목·설명·위반 예, 담당 파일 목록, 담당 파일의 기존 지적 목록(`id`, `source`, `symbol`, `title`), 그리고 고쳐진 지적 목록.

**고쳐진 지적**은 기존 지적 중 `status` 가 `resolved` 이고 `fixLevel` 이 있는 것이다. `review-fix` 로 고쳐서 해결된 지적이다. `id`, `symbol`, `title` 을 "고쳐진 지적"이라고 표시해 따로 넘긴다. 에이전트가 그 수정을 되돌리자는 지적을 내지 않게 하기 위해서다.

반환에서 `verdict` 가 `violation` 인 항목만 `violations` 에 넣는다. `ruleId` 를 `source` 로 옮긴다.

```json
{ "source": "R-001", "file": "...", "symbol": "...", "title": "...", "evidence": "...", "matches": null }
```

## 5. 자유 탐색

`anetos-review:explorer` 를 **하나만** 띄운다. 범위가 커도 나누지 않는다.

넘기는 내용: 범위 파일 목록, 규칙의 ID 와 제목 목록, 범위의 기존 지적 목록(`id`, `source`, `symbol`, `title`, `status`), 그리고 4단계와 같은 고쳐진 지적 목록.

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

각 후보와 반환을 합쳐 `candidates` 에 넣는다. `claim` 을 `title` 로 옮긴다. `file`, `symbol`, `evidence` 는 explorer 가 낸 값을 그대로 쓰고, verifier 의 반환에서는 `verdict` 만 가져온다. verifier 가 `unconfirmed` 일 때 `evidence` 를 비워서 돌려줘도 후보의 `evidence` 는 비우지 않는다.

`file` 은 항상 저장소 루트 기준 상대 경로로 적는다. 에이전트가 절대 경로로 돌려줬으면 상대 경로로 바꾼다.

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

`decided` 는 이전에 "의도된 설계" 또는 "기각"으로 결정했고 그 뒤로 파일이 바뀌지 않은 지적이다. 다시 논의할 것이 없으므로 "기존 결정 유지 N건" 으로 개수만 한 줄로 알리고, 결정을 요청하지 않는다. 재검토 요청은 결정 이후 그 파일이 바뀐 경우에만 생긴다.

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
