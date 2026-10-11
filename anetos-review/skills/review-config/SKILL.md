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
