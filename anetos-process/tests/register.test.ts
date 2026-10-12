import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { AgentRun, Flow } from '../types'

const PLUGIN = 'anetos-process'
const SURFACES = ['terminal', 'desktop'] as const
const ROOT = 'C:/plugins/anetos-review/scripts'

const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 110 } as never,
} as const

const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'anetos-process',
  props: { title: 'anetos-review', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
} as const

type Shell = { stdout: string; stderr?: string; isError?: boolean }

// 플러그인 아래에서 셸 도구 노릇을 한다: 명령에 들어 있는 글자로 출력을 고른다.
function shell(on: On, outputs: Record<string, Shell>): string[] {
  const seen: string[] = []
  on('tool.call', (async (_$: unknown, e: { command?: unknown }) => {
    const command = String(e.command ?? '')
    seen.push(command)
    const hit = Object.entries(outputs).find(([needle]) => command.includes(needle))?.[1]
    const result = { stdout: hit?.stdout ?? '', stderr: hit?.stderr ?? '', interrupted: false }
    return hit?.isError ? { result, isError: true } : { result }
  }) as never)
  return seen
}

function agentsBeneath(on: On): void {
  let n = 0
  on('agent.spawn', (async () => ({ model: 'claude-opus-5-5-20260101', agentId: `ag-${++n}` })) as never)
  on('turn.complete', (async () => ({ text: '' })) as never)
}

type Seen = { flow: Flow | null; agents: AgentRun[]; toasts: string[]; opened: string[] }

// 플러그인 아래에서 화면과 상태 저장소 노릇을 하며, 플러그인이 쓴 값을 기억해 둔다.
function host(on: On): Seen {
  const seen: Seen = { flow: null, agents: [], toasts: [], opened: [] }
  on('state.set', (async (_$: unknown, e: { plugin: string; key: 'flow' | 'agents'; value: never }, next: (e: unknown) => unknown) => {
    if (e.plugin === PLUGIN && (e.key === 'flow' || e.key === 'agents')) seen[e.key] = e.value
    return next(e)
  }) as never)
  on('ui.open', (async (_$: unknown, e: { id: string }) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  }) as never)
  on('ui.toast', (async (_$: unknown, e: { text?: string }) => {
    seen.toasts.push(String(e.text ?? ''))
    return { value: undefined }
  }) as never)
  return seen
}

const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)

const spawn = ($: Engine, type: string, prompt: string, description: string) =>
  $.agent.spawn({
    tool_use_id: `tu-${type}-${description}`,
    prompt,
    description,
    subagentType: `anetos-review:${type}`,
    provider: { plugin: 'anetos-review', tier: 'user' },
  } as never)

const complete = ($: Engine, agentId: string, reason = 'answer') =>
  $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: `t-${agentId}`, reason, agentId } as never)

const statusOf = (flow: Flow | null, key: string): string | undefined => flow?.stages.find(s => s.key === key)?.status

test('도구 호출의 결과를 그대로 돌려주고, 무관한 명령은 흐름을 만들지 않는다', async ($, on) => {
  mock.clock(on)
  const seen = host(on)
  const commands = shell(on, { 'npm test': { stdout: 'ok\n' }, 'ledger.mjs" init': { stdout: '{ "created": true }\n' } })

  const plain = await bash($, 'npm test')
  expect(plain.result).toEqual({ stdout: 'ok\n', stderr: '', interrupted: false })
  expect(seen.flow).toBeNull()

  const init = await bash($, `node "${ROOT}/ledger.mjs" init`)
  expect(init.result).toEqual({ stdout: '{ "created": true }\n', stderr: '', interrupted: false })
  expect(commands).toEqual(['npm test', `node "${ROOT}/ledger.mjs" init`])
  expect(seen.flow?.kind).toBe('review')
})

test('리뷰 흐름: 에이전트와 원장 갱신을 따라간다', async ($, on) => {
  const clock = mock.clock(on)
  const seen = host(on)
  agentsBeneath(on)
  shell(on, {
    'ledger.mjs" init': { stdout: '{ "created": false }' },
    'ledger.mjs" apply': {
      stdout: JSON.stringify({ new: ['F-1'], stillOpen: [], resolved: ['F-2'], recurred: [], reopenRequested: [], decided: [], dismissed: [] }),
    },
  })

  await bash($, `node "${ROOT}/ledger.mjs" init`)
  await spawn($, 'rule-checker', '규칙을 검사해 주세요', '규칙 검사 src')
  await spawn($, 'explorer', '후보를 찾아 주세요', '자유 탐색 src')
  await spawn($, 'general-purpose-like', '무관', '무관한 에이전트')

  let flow = seen.flow
  expect(statusOf(flow, 'rules')).toBe('running')
  expect(statusOf(flow, 'explore')).toBe('running')
  expect(seen.agents.map(a => a.role)).toEqual(['rule-checker', 'explorer'])

  await clock.advance(3000)
  await complete($, 'ag-1')
  await complete($, 'ag-2', 'error')
  flow = seen.flow
  expect(statusOf(flow, 'rules')).toBe('done')
  expect(statusOf(flow, 'explore')).toBe('done')
  const list = seen.agents
  expect(list.map(a => a.status)).toEqual(['done', 'failed'])
  expect(list[0]?.model).toBe('claude-opus-5-5-20260101')

  await bash($, `node "${ROOT}/ledger.mjs" apply .review/results.tmp`)
  flow = seen.flow
  expect(flow?.outcome).toBe('done')
  expect(flow?.summary).toBe('신규 1 · 해결 1')
})

test('수정 흐름: 재시도와 커밋, 그리고 실패한 start', async ($, on) => {
  mock.clock(on)
  const seen = host(on)
  agentsBeneath(on)
  const outputs: Record<string, Shell> = {
    'start F-missing': { stdout: '', stderr: '원장에 없는 id 입니다: F-missing', isError: true },
    'start F-c6e90533': { stdout: '검사 실행: test → node --test\n{ "id": "F-c6e90533", "baseline": [], "masked": [] }' },
    'ledger.mjs" list': { stdout: '[{ "id": "F-c6e90533", "title": "할인율을 10으로 나눔" }]' },
    'stage red': { stdout: '{ "ok": false, "reasons": ["repro-not-failing"], "verdicts": [] }' },
    'stage fixed': { stdout: '{ "ok": true, "reasons": [], "level": "guarded", "outOfScope": [] }' },
    'fix.mjs" finish': { stdout: '{ "id": "F-c6e90533", "level": "guarded", "commit": "abc1234" }' },
  }
  shell(on, outputs)

  await bash($, `node "${ROOT}/fix.mjs" start F-missing`)
  expect(seen.flow).toBeNull()

  await bash($, `node "${ROOT}/fix.mjs" start F-c6e90533`)
  await bash($, `node "${ROOT}/ledger.mjs" list --status open`)
  let flow = seen.flow
  expect(flow?.title).toBe('수정 F-c6e90533')
  expect(seen.opened).toEqual(['anetos-process'])
  expect(flow?.detail).toBe('할인율을 10으로 나눔')

  await spawn($, 'fixer', 'mode: tests\nfile: src/cart.js', '재현 테스트 작성')
  await complete($, 'ag-1')
  await bash($, `node "${ROOT}/fix.mjs" stage red --repro yes`)
  expect(statusOf(seen.flow, 'red')).toBe('retry')

  outputs['stage red'] = { stdout: '{ "ok": true, "reasons": [] }' }
  await bash($, `node "${ROOT}/fix.mjs" stage red --repro no`)
  await spawn($, 'fixer', 'mode: fix', '할인율 수정')
  await complete($, 'ag-2')
  await spawn($, 'verifier', 'mode: recheck\nid: F-c6e90533', '지적 재확인')
  await complete($, 'ag-3')
  await bash($, `node "${ROOT}/fix.mjs" stage fixed --recheck absent`)
  await bash($, `node "${ROOT}/fix.mjs" finish`)

  flow = seen.flow
  expect(flow?.outcome).toBe('committed')
  expect(flow?.summary).toBe('커밋 abc1234 · guarded')
  expect(flow?.stages.map(s => s.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done'])
  expect(seen.agents.map(a => `${a.role}:${a.mode}`)).toEqual(['fixer:tests', 'fixer:fix', 'verifier:recheck'])
})

test('새 흐름이 시작되면 지난 흐름의 끝난 에이전트를 치운다', async ($, on) => {
  mock.clock(on)
  const seen = host(on)
  agentsBeneath(on)
  shell(on, { 'ledger.mjs" init': { stdout: '{}' }, 'fix.mjs" start': { stdout: '{ "id": "F-1", "masked": [] }' } })

  await bash($, `node "${ROOT}/ledger.mjs" init`)
  await spawn($, 'rule-checker', '', '규칙 검사')
  await complete($, 'ag-1')
  await spawn($, 'explorer', '', '자유 탐색')
  expect(seen.agents).toHaveLength(2)

  await bash($, `node "${ROOT}/fix.mjs" start F-1`)
  const left = seen.agents
  expect(left.map(a => a.role)).toEqual(['explorer'])
  expect(left[0]?.status).toBe('running')
})

test('진행 바와 패널이 두 표면에서 그려진다', async ($, on) => {
  mock.clock(on)
  const seen = host(on)
  agentsBeneath(on)
  shell(on, { 'fix.mjs" start': { stdout: '{ "id": "F-c6e90533", "masked": ["lint"] }' } })
  await bash($, `node "${ROOT}/fix.mjs" start F-c6e90533`)
  await spawn($, 'fixer', 'mode: tests', '재현 테스트 작성')

  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ key: 'anetos-agents' })).toBeDefined()
    expect(await band.find({ key: 'anetos-dismiss' })).toBeDefined()
    if (surface === 'desktop') {
      const drawn = await band.find({ type: 'Svg' })
      expect(String(drawn?.props.source)).toContain('수정 F-c6e90533')
      expect(String(drawn?.props.source)).toContain('테스트 작성')
      expect(String(drawn?.props.alt)).toContain('1/7')
    } else {
      expect(await band.find({ type: 'Text', text: /수정 F-c6e90533/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /테스트 작성/ })).toBeDefined()
    }
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    if (surface === 'desktop') {
      const sources = (await pane.findAll({ type: 'Svg' })).map(el => String(el.props.source)).join('\n')
      expect(sources).toContain('가려진 검사: lint')
      expect(sources).toContain('재현 테스트 작성')
      expect(sources).toContain('asprite')
    } else {
      expect(await pane.find({ type: 'Text', text: /기준선/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /가려진 검사: lint/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /재현 테스트 작성/ })).toBeDefined()
    }
    await pane.unmount()
  }
})

test('흐름이 없을 때 패널은 안내를 보여 주고, ✕ 는 진행 바를 치운다', async ($, on) => {
  mock.clock(on)
  const seen = host(on)
  shell(on, { 'ledger.mjs" init': { stdout: '{}' } })

  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Text', text: /아직 실행된 리뷰가 없습니다/ })).toBeDefined()
    await pane.unmount()
  }

  await bash($, `node "${ROOT}/ledger.mjs" init`)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'anetos-dismiss' })
  expect(seen.flow).toBeNull()
  await band.unmount()
})

test('완료 내역 초기화 버튼은 끝난 흐름과 끝난 에이전트만 치운다', async ($, on) => {
  mock.clock(on)
  const seen = host(on)
  agentsBeneath(on)
  shell(on, { 'ledger.mjs" init': { stdout: '{}' }, 'ledger.mjs" apply': { stdout: '{ "new": ["F-1"] }' } })

  await bash($, `node "${ROOT}/ledger.mjs" init`)
  await spawn($, 'rule-checker', '', '규칙 검사')
  await complete($, 'ag-1')
  await spawn($, 'explorer', '', '자유 탐색')

  // 진행 중: 끝난 에이전트만 치우고 흐름은 남긴다.
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'clear' })
  await pane.unmount()
  expect(seen.flow?.outcome).toBe('running')
  expect(seen.agents.map(a => a.role)).toEqual(['explorer'])

  await complete($, 'ag-2')
  await bash($, `node "${ROOT}/ledger.mjs" apply .review/results.tmp`)
  expect(seen.flow?.outcome).toBe('done')

  for (const surface of SURFACES) {
    pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ key: 'clear' })).toBeDefined()
    await pane.unmount()
  }
  pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'clear' })
  await pane.unmount()
  expect(seen.flow).toBeNull()
  expect(seen.agents).toEqual([])
})

test('/anetos-process 가 패널을 열고 닫는다', async ($, on) => {
  mock.clock(on)
  const open = new Set<string>()
  const registered: string[] = []
  on('session.start', (async (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd })) as never)
  on('command.register', (async (_$: unknown, e: { name: string }) => {
    registered.push(e.name)
    return { value: undefined }
  }) as never)
  on('ui.panes', (async () => ({ value: [...open].map(id => ({ id })) })) as never)
  on('ui.open', (async (_$: unknown, e: { id: string }) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  }) as never)
  on('ui.close', (async (_$: unknown, e: { id: string }) => {
    open.delete(e.id)
    return { value: undefined }
  }) as never)

  await $.session.start({ cwd: 'C:/repo', surface: 'terminal', isInteractive: true } as never)
  expect(registered).toEqual(['anetos-process'])

  const run = () =>
    $.command.run({ command: 'anetos-process', args: '', origin: { kind: 'user' }, presentation: {} } as never) as Promise<{ text?: string }>
  expect((await run()).text).toBe('패널을 열었습니다.')
  expect([...open]).toEqual(['anetos-process'])
  expect((await run()).text).toBe('패널을 닫았습니다.')
  expect([...open]).toEqual([])
})
