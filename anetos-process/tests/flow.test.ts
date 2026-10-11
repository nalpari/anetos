import { describe, expect, test } from 'claude-code/testing'

import {
  activeLabel,
  modeOf,
  parseCommands,
  parseJson,
  progress,
  reduce,
  roleOf,
  taskLabel,
} from '../hooks/flow'
import type { FlowEvent } from '../hooks/flow'
import type { Flow } from '../types'

const ROOT = 'C:/Users/me/.claude/plugins/anetos-review'

const script = (
  scriptName: 'ledger' | 'fix',
  sub: string,
  args: string[],
  data: unknown,
  ok = true,
  at = 1000,
): FlowEvent => ({ type: 'script', call: { script: scriptName, sub, args }, ok, data, at })

const start = (role: 'rule-checker' | 'explorer' | 'verifier' | 'fixer', mode = '', at = 1000): FlowEvent => ({
  type: 'agent-start',
  role,
  mode,
  at,
})

const end = (
  role: 'rule-checker' | 'explorer' | 'verifier' | 'fixer',
  mode = '',
  isRoleStillRunning = false,
  at = 2000,
): FlowEvent => ({ type: 'agent-end', role, mode, isRoleStillRunning, at })

const run = (events: FlowEvent[], from: Flow | null = null): Flow | null =>
  events.reduce<Flow | null>((flow, ev) => reduce(flow, ev), from)

const statusOf = (flow: Flow | null, key: string): string | undefined =>
  flow?.stages.find(s => s.key === key)?.status

const noteOf = (flow: Flow | null, key: string): string | undefined => flow?.stages.find(s => s.key === key)?.note

describe('parseCommands', () => {
  test('스킬이 쓰는 형태를 읽는다', () => {
    expect(parseCommands(`node "${ROOT}/scripts/ledger.mjs" init`)).toEqual([
      { script: 'ledger', sub: 'init', args: [] },
    ])
    expect(parseCommands(`node "${ROOT}/scripts/ledger.mjs" apply .review/results.tmp`)).toEqual([
      { script: 'ledger', sub: 'apply', args: ['.review/results.tmp'] },
    ])
    expect(parseCommands(`node "${ROOT}/scripts/fix.mjs" start F-c6e90533`)).toEqual([
      { script: 'fix', sub: 'start', args: ['F-c6e90533'] },
    ])
  })

  test('fix 의 stage 는 하위 명령과 합친다', () => {
    expect(parseCommands(`node "${ROOT}/scripts/fix.mjs" stage red --repro yes`)).toEqual([
      { script: 'fix', sub: 'stage red', args: ['--repro', 'yes'] },
    ])
    expect(parseCommands(`node '${ROOT}/scripts/fix.mjs' stage fixed --recheck absent`)).toEqual([
      { script: 'fix', sub: 'stage fixed', args: ['--recheck', 'absent'] },
    ])
  })

  test('경로와 따옴표, 셸이 달라도 읽는다', () => {
    expect(parseCommands('node C:\\dev\\anetos\\anetos-review\\scripts\\fix.mjs abort')).toEqual([
      { script: 'fix', sub: 'abort', args: [] },
    ])
    expect(parseCommands('cd /repo && node ./scripts/ledger.mjs list --status open | head')).toEqual([
      { script: 'ledger', sub: 'list', args: ['--status', 'open'] },
    ])
    expect(parseCommands('& node "C:\\p\\scripts\\ledger.mjs" list --ids "F-1, F-2"')).toEqual([
      { script: 'ledger', sub: 'list', args: ['--ids', 'F-1, F-2'] },
    ])
  })

  test('한 호출에 명령이 여럿이면 모두 돌려준다', () => {
    const calls = parseCommands(`node "${ROOT}/scripts/ledger.mjs" init; node "${ROOT}/scripts/ledger.mjs" list --files a.js`)
    expect(calls.map(c => c.sub)).toEqual(['init', 'list'])
  })

  test('무관한 명령은 빈 배열이다', () => {
    expect(parseCommands('npm test')).toEqual([])
    expect(parseCommands('cat scripts/ledger.mjs')).toEqual([])
    expect(parseCommands('node other-ledger.mjsx init')).toEqual([])
    expect(parseCommands('')).toEqual([])
  })
})

describe('parseJson', () => {
  test('출력에서 첫 JSON 값을 찾는다', () => {
    expect(parseJson('{\n  "ok": true\n}\n')).toEqual({ ok: true })
    expect(parseJson('검사 실행: test → node --test\n{ "id": "F-1", "masked": [] }')).toEqual({ id: 'F-1', masked: [] })
    expect(parseJson('[{"id":"F-1"}]')).toEqual([{ id: 'F-1' }])
  })

  test('JSON 이 없거나 깨졌으면 undefined', () => {
    expect(parseJson('')).toBeUndefined()
    expect(parseJson('아무 출력')).toBeUndefined()
    expect(parseJson('{ "ok": tru')).toBeUndefined()
  })
})

describe('에이전트 식별', () => {
  test('anetos-review 의 네 종류만 역할로 읽는다', () => {
    expect(roleOf('anetos-review:rule-checker')).toBe('rule-checker')
    expect(roleOf('anetos-review:explorer')).toBe('explorer')
    expect(roleOf('anetos-review:verifier')).toBe('verifier')
    expect(roleOf('anetos-review:fixer')).toBe('fixer')
    expect(roleOf('general-purpose')).toBeNull()
    expect(roleOf('savvy-flow:savvy-light')).toBeNull()
    expect(roleOf('other:verifier')).toBeNull()
  })

  test('요청에서 mode 를 읽는다', () => {
    expect(modeOf('mode: recheck\nid: F-1')).toBe('recheck')
    expect(modeOf('다음을 검증해 주세요.\n\nmode:candidate\nfile: a.js')).toBe('candidate')
    expect(modeOf('- mode: `tests`')).toBe('tests')
    expect(modeOf('mode: fix')).toBe('fix')
    expect(modeOf('mode: other')).toBe('')
    expect(modeOf('아무 말')).toBe('')
  })

  test('하는 일을 한국어로 쓴다', () => {
    expect(taskLabel('rule-checker', '')).toBe('규칙 검사')
    expect(taskLabel('explorer', '')).toBe('자유 탐색')
    expect(taskLabel('verifier', 'recheck')).toBe('지적 재확인')
    expect(taskLabel('verifier', 'candidate')).toBe('후보 검증')
    expect(taskLabel('verifier', '')).toBe('검증')
    expect(taskLabel('fixer', 'tests')).toBe('테스트 작성')
    expect(taskLabel('fixer', 'fix')).toBe('수정')
  })
})

describe('리뷰 흐름', () => {
  const SUMMARY = {
    new: ['F-1', 'F-2'],
    stillOpen: ['F-3'],
    resolved: [],
    recurred: [],
    reopenRequested: ['F-4'],
    decided: [],
    dismissed: ['F-5'],
  }

  test('init 이 흐름을 시작한다', () => {
    const flow = run([script('ledger', 'init', [], { created: false }, true, 500)])
    expect(flow?.kind).toBe('review')
    expect(flow?.title).toBe('리뷰')
    expect(flow?.outcome).toBe('running')
    expect(flow?.startedAt).toBe(500)
    expect(flow?.stages.map(s => s.key)).toEqual(['load', 'recheck', 'rules', 'explore', 'verify', 'apply'])
    expect(statusOf(flow, 'load')).toBe('running')
    expect(progress(flow)).toEqual({ done: 0, total: 6 })
  })

  test('동시에 도는 단계를 따로 센다', () => {
    const flow = run([
      script('ledger', 'init', [], {}),
      start('rule-checker'),
      start('explorer'),
    ])
    expect(statusOf(flow, 'load')).toBe('done')
    expect(statusOf(flow, 'rules')).toBe('running')
    expect(statusOf(flow, 'explore')).toBe('running')
    expect(activeLabel(flow)).toBe('규칙 검사 · 자유 탐색')

    const later = run([end('explorer')], flow)
    expect(statusOf(later, 'explore')).toBe('done')
    expect(statusOf(later, 'rules')).toBe('running')
    expect(progress(later)).toEqual({ done: 2, total: 6 })
  })

  test('같은 역할의 에이전트가 남아 있으면 단계가 끝나지 않는다', () => {
    const flow = run([
      script('ledger', 'init', [], {}),
      start('verifier', 'recheck'),
      start('verifier', 'recheck'),
      end('verifier', 'recheck', true),
    ])
    expect(statusOf(flow, 'recheck')).toBe('running')
    expect(statusOf(run([end('verifier', 'recheck', false)], flow), 'recheck')).toBe('done')
  })

  test('apply 가 흐름을 끝내고, 시작하지 않은 단계는 건너뜀이 된다', () => {
    const flow = run([
      script('ledger', 'init', [], {}),
      start('rule-checker'),
      end('rule-checker'),
      start('explorer'),
      end('explorer'),
      script('ledger', 'apply', ['.review/results.tmp'], SUMMARY, true, 9000),
    ])
    expect(flow?.outcome).toBe('done')
    expect(flow?.endedAt).toBe(9000)
    expect(statusOf(flow, 'recheck')).toBe('skipped')
    expect(statusOf(flow, 'verify')).toBe('skipped')
    expect(statusOf(flow, 'apply')).toBe('done')
    expect(flow?.summary).toBe('신규 2 · 열림 1 · 재검토 요청 1 · 기각 1')
    expect(progress(flow)).toEqual({ done: 6, total: 6 })
    expect(activeLabel(flow)).toBe('신규 2 · 열림 1 · 재검토 요청 1 · 기각 1')
  })

  test('지적이 하나도 없으면 그렇게 쓴다', () => {
    const empty = { new: [], stillOpen: [], resolved: [], recurred: [], reopenRequested: [], decided: [], dismissed: [] }
    const flow = run([script('ledger', 'init', [], {}), script('ledger', 'apply', ['x'], empty)])
    expect(flow?.summary).toBe('지적 없음')
  })

  test('apply 가 실패하면 흐름을 열어 두고, 다시 실행하면 그 결과로 끝난다', () => {
    const failed = run([
      script('ledger', 'init', [], {}),
      script('ledger', 'apply', ['x'], undefined, false),
    ])
    expect(failed?.outcome).toBe('running')
    expect(statusOf(failed, 'apply')).toBe('failed')
    expect(noteOf(failed, 'apply')).toBe('원장 갱신 실패')

    const retried = run([script('ledger', 'apply', ['x'], SUMMARY)], failed)
    expect(retried?.outcome).toBe('done')
    expect(statusOf(retried, 'apply')).toBe('done')
    expect(retried?.stages.find(s => s.key === 'apply')?.tries).toBe(2)
  })

  test('init 을 놓쳐도 에이전트가 시작되면 리뷰 흐름으로 본다', () => {
    const flow = run([start('rule-checker', '', 700)])
    expect(flow?.kind).toBe('review')
    expect(flow?.startedAt).toBe(700)
    expect(statusOf(flow, 'load')).toBe('done')
    expect(statusOf(flow, 'rules')).toBe('running')
  })

  test('끝난 흐름 뒤의 init 은 새 흐름이다', () => {
    const done = run([script('ledger', 'init', [], {}), script('ledger', 'apply', ['x'], SUMMARY)])
    const next = run([script('ledger', 'init', [], {}, true, 5000)], done)
    expect(next?.outcome).toBe('running')
    expect(next?.startedAt).toBe(5000)
    expect(next?.summary).toBe('')
  })

  test('리뷰와 무관한 ledger 명령은 흐름을 바꾸지 않는다', () => {
    const flow = run([script('ledger', 'init', [], {})])
    for (const sub of ['list', 'ids', 'id', 'decide']) {
      expect(run([script('ledger', sub, [], {})], flow)).toEqual(flow)
    }
    expect(run([script('ledger', 'list', [], [])])).toBeNull()
  })
})

describe('수정 흐름', () => {
  const ID = 'F-c6e90533'
  const started = (masked: string[] = []): FlowEvent =>
    script('fix', 'start', [ID], { id: ID, baseline: [], masked }, true, 100)

  test('start 가 흐름을 시작하고 가려진 검사를 적는다', () => {
    const flow = run([started(['lint', 'types'])])
    expect(flow?.kind).toBe('fix')
    expect(flow?.title).toBe(`수정 ${ID}`)
    expect(flow?.findingId).toBe(ID)
    expect(flow?.stages.map(s => s.key)).toEqual(['baseline', 'tests', 'red', 'fix', 'recheck', 'green', 'commit'])
    expect(statusOf(flow, 'baseline')).toBe('done')
    expect(noteOf(flow, 'baseline')).toBe('가려진 검사: lint, types')
    expect(progress(flow)).toEqual({ done: 1, total: 7 })
  })

  test('start 가 실패하면 흐름을 만들지 않고 기존 흐름도 그대로 둔다', () => {
    expect(run([script('fix', 'start', [ID], undefined, false)])).toBeNull()
    const flow = run([started()])
    expect(run([script('fix', 'start', ['F-other'], undefined, false)], flow)).toEqual(flow)
  })

  test('처음부터 커밋까지', () => {
    const flow = run([
      started(),
      start('fixer', 'tests'),
      end('fixer', 'tests'),
      script('fix', 'stage red', ['--repro', 'yes'], { ok: true, reasons: [], verdicts: [] }),
      start('fixer', 'fix'),
      end('fixer', 'fix'),
      start('verifier', 'recheck'),
      end('verifier', 'recheck'),
      script('fix', 'stage fixed', ['--recheck', 'absent'], { ok: true, reasons: [], level: 'reproduced', outOfScope: [] }),
      script('fix', 'finish', [], { id: ID, level: 'reproduced', commit: 'abc1234' }, true, 9000),
    ])
    expect(flow?.outcome).toBe('committed')
    expect(flow?.endedAt).toBe(9000)
    expect(flow?.stages.map(s => s.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done'])
    expect(noteOf(flow, 'green')).toBe('reproduced')
    expect(noteOf(flow, 'commit')).toBe('abc1234')
    expect(flow?.summary).toBe('커밋 abc1234 · reproduced')
    expect(progress(flow)).toEqual({ done: 7, total: 7 })
  })

  test('판정이 통과하지 못하면 재시도로 표시하고 이유를 적는다', () => {
    const red = run([
      started(),
      start('fixer', 'tests'),
      end('fixer', 'tests'),
      script('fix', 'stage red', ['--repro', 'yes'], { ok: false, reasons: ['repro-not-failing'], verdicts: [] }),
    ])
    expect(statusOf(red, 'red')).toBe('retry')
    expect(noteOf(red, 'red')).toBe('repro-not-failing')
    expect(activeLabel(red)).toBe('빨강 확인 (재시도 1)')

    const again = run(
      [
        start('fixer', 'tests'),
        end('fixer', 'tests'),
        script('fix', 'stage red', ['--repro', 'no'], { ok: true, reasons: [] }),
      ],
      red,
    )
    expect(statusOf(again, 'red')).toBe('done')
    expect(again?.stages.find(s => s.key === 'red')?.tries).toBe(2)
    expect(noteOf(again, 'red')).toBe('2번째에 통과')
  })

  test('초록 확인에 범위 밖 파일이 있으면 적는다', () => {
    const flow = run([
      started(),
      script('fix', 'stage red', ['--repro', 'no'], { ok: true, reasons: [] }),
      start('fixer', 'fix'),
      end('fixer', 'fix'),
      script('fix', 'stage fixed', ['--recheck', 'absent'], { ok: true, reasons: [], level: 'guarded', outOfScope: ['src/db.js', 'x.md'] }),
    ])
    expect(noteOf(flow, 'green')).toBe('guarded · 범위 밖 2개')
    expect(statusOf(flow, 'tests')).toBe('skipped')
  })

  test('abort 는 어느 단계에서든 흐름을 중단으로 끝낸다', () => {
    const flow = run([
      started(),
      start('fixer', 'tests'),
      end('fixer', 'tests'),
      script('fix', 'stage red', ['--repro', 'yes'], { ok: false, reasons: ['non-test-file-changed'] }),
      script('fix', 'abort', [], { aborted: true, id: ID, fixAttempts: 1, unrestored: [], headMoved: false }, true, 4000),
    ])
    expect(flow?.outcome).toBe('aborted')
    expect(flow?.endedAt).toBe(4000)
    expect(statusOf(flow, 'red')).toBe('failed')
    expect(statusOf(flow, 'fix')).toBe('skipped')
    expect(statusOf(flow, 'commit')).toBe('skipped')
    expect(flow?.summary).toBe('중단됨 · non-test-file-changed')
  })

  test('되돌릴 것이 없던 abort 는 흐름을 바꾸지 않는다', () => {
    const flow = run([started()])
    expect(run([script('fix', 'abort', [], { aborted: false })], flow)).toEqual(flow)
  })

  test('finish 가 실패하면 커밋 단계를 실패로 두고 흐름을 열어 둔다', () => {
    const flow = run([
      started(),
      script('fix', 'stage red', ['--repro', 'no'], { ok: true }),
      script('fix', 'stage fixed', ['--recheck', 'absent'], { ok: true, level: 'guarded', outOfScope: [] }),
      script('fix', 'finish', [], undefined, false),
    ])
    expect(flow?.outcome).toBe('running')
    expect(statusOf(flow, 'commit')).toBe('failed')
    expect(noteOf(flow, 'commit')).toBe('커밋 실패')
  })

  test('원장 조회 결과에서 지적의 제목을 읽는다', () => {
    const flow = run([
      started(),
      script('ledger', 'list', ['--status', 'open'], [
        { id: 'F-other', title: '다른 지적' },
        { id: ID, title: '할인율을 10으로 나눔' },
      ]),
    ])
    expect(flow?.detail).toBe('할인율을 10으로 나눔')
  })

  test('새 start 는 이전 흐름을 바꾼다', () => {
    const first = run([started(), script('fix', 'finish', [], { commit: 'aaa', level: 'guarded' })])
    const second = run([script('fix', 'start', ['F-next'], { id: 'F-next', masked: [] }, true, 7000)], first)
    expect(second?.title).toBe('수정 F-next')
    expect(second?.outcome).toBe('running')
    expect(second?.startedAt).toBe(7000)
  })

  test('결과를 읽지 못한 판정은 실행된 사실만 반영한다', () => {
    const flow = run([started(), script('fix', 'stage red', ['--repro', 'yes'], undefined)])
    expect(statusOf(flow, 'red')).toBe('done')
    expect(noteOf(flow, 'red')).toBe('결과 알 수 없음')
  })

  test('모르는 필드가 있고 기대한 필드가 없어도 깨지지 않는다', () => {
    const flow = run([
      script('fix', 'start', [ID], { extra: 1 }),
      script('fix', 'stage fixed', [], { ok: true, future: [1, 2] }),
      script('fix', 'finish', [], { somethingElse: true }),
    ])
    expect(flow?.outcome).toBe('committed')
    expect(noteOf(flow, 'baseline')).toBe('')
    expect(noteOf(flow, 'green')).toBe('')
    expect(flow?.summary).toBe('커밋됨')
  })
})
