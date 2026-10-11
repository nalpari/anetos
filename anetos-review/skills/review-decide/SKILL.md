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
