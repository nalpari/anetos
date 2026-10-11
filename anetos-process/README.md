# anetos-process

`anetos-review` 의 리뷰와 수정이 지금 어디까지 왔는지 보여 주는 Claude Code mod.

- **진행 바** (프롬프트 위): 흐름의 이름, 단계마다 한 칸인 바, 지금 진행 중인 단계, 끝난 단계 수.
- **패널** (`/anetos-process` 로 여닫음): 단계 목록과 한 줄 결과, 에이전트 목록(하는 일, 모델, 걸린 시간, 토큰).
- **캐릭터**: 에이전트는 역할에 맞는 픽셀 캐릭터로 그려지고 일하는 동안 움직인다. 규칙 검사관(클립보드), 탐험가(손전등), 검증관(도장), 수리공(망치). 데스크톱 앱에서만 보이고, 터미널에서는 같은 정보를 글자로 보여 준다.

## 어떻게 아는가

모델에게 묻지 않는다. 엔진의 이벤트와 `anetos-review` 스크립트의 출력만 읽는다.

- `ledger.mjs` 와 `fix.mjs` 를 실행하는 셸 명령과 그 JSON 결과 → 단계의 시작, 통과 여부, 결과
- `anetos-review:` 로 시작하는 서브에이전트의 시작과 종료 → 에이전트 목록과 에이전트가 맡은 단계

읽기만 한다. 도구 호출을 막거나 바꾸지 않고, 모델이 호출하는 도구를 등록하지 않는다. `anetos-review` 없이 설치하면 아무것도 표시하지 않는다.

## 설치

```
/plugin install anetos-process --marketplace nalpari/anetos
```

개발 중인 폴더에서 바로 불러오려면:

```bash
claude --plugin-dir C:\dev\anetos\anetos-review --plugin-dir C:\dev\anetos\anetos-process
```

## 개발

```bash
claude plugin validate anetos-process
```

```bash
claude plugin test anetos-process
```

`anetos-review` 스크립트의 출력 형식이 바뀌면 이 mod 의 해석도 고쳐야 한다. 저장소 루트의 대조 테스트가 두 스크립트를 실제로 실행해서 어긋남을 잡는다.

```bash
node --experimental-strip-types --test tests/process-contract.test.mjs
```

구조:

| 파일 | 하는 일 |
|---|---|
| `hooks/flow.ts` | 명령 해석과 단계 계산 (순수 함수) |
| `hooks/sprites.ts` | 캐릭터 그림 (순수 함수) |
| `hooks/draw.ts` | 데스크톱용 SVG 와 글자 다듬기 (순수 함수) |
| `hooks/register.tsx` | 이벤트 연결과 화면 |
| `types/index.d.ts` | 상태 형식 |

구조와 이벤트 사용법은 [savvy-progress](https://github.com/JohnnyVizz/claude-kit) 를 참고했다. 코드와 그림은 새로 썼다.
