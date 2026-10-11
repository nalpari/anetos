// 명령 해석과 단계 계산. 엔진을 쓰지 않는 순수 함수만 둔다.
import type { Flow, FlowKind, Role, Stage, StageStatus } from '../types'

export type ScriptCall = {
  script: 'ledger' | 'fix'
  /** 하위 명령. fix 의 stage 는 'stage red', 'stage fixed' 로 합친다. */
  sub: string
  args: string[]
}

export type FlowEvent =
  | { type: 'script'; call: ScriptCall; ok: boolean; data: unknown; at: number }
  | { type: 'agent-start'; role: Role; mode: string; at: number }
  | { type: 'agent-end'; role: Role; mode: string; isRoleStillRunning: boolean; at: number }

const SUBCOMMANDS: Record<ScriptCall['script'], readonly string[]> = {
  ledger: ['init', 'list', 'id', 'ids', 'apply', 'decide'],
  fix: ['config', 'start', 'stage', 'finish', 'abort'],
}

const SCRIPT = /(?:^|[\\/"'\s])(ledger|fix)\.mjs["']?[ \t]+([a-z]+)/g
const ARG = /^[ \t]+(?:"([^"]*)"|'([^']*)'|([^\s;|&<>"']+))/

// 명령 문자열에서 ledger.mjs / fix.mjs 호출을 찾는다. 경로와 따옴표, 셸은 가리지 않는다.
export function parseCommands(command: string): ScriptCall[] {
  const calls: ScriptCall[] = []
  for (const m of command.matchAll(SCRIPT)) {
    const script = m[1] as ScriptCall['script']
    const sub = m[2] ?? ''
    if (!SUBCOMMANDS[script].includes(sub)) continue

    const args: string[] = []
    let rest = command.slice((m.index ?? 0) + m[0].length)
    for (;;) {
      const a = ARG.exec(rest)
      if (!a) break
      args.push(a[1] ?? a[2] ?? a[3] ?? '')
      rest = rest.slice(a[0].length)
    }

    if (script === 'fix' && sub === 'stage') {
      const which = args.shift()
      if (which !== 'red' && which !== 'fixed') continue
      calls.push({ script, sub: `stage ${which}`, args })
    } else {
      calls.push({ script, sub, args })
    }
  }
  return calls
}

// 출력에서 첫 JSON 값을 찾는다. 스크립트는 JSON 앞에 안내 줄을 찍을 수 있다.
export function parseJson(text: string): unknown {
  let tries = 0
  for (let i = 0; i < text.length && tries < 20; i++) {
    const open = text[i]
    if (open !== '{' && open !== '[') continue
    tries++
    const end = text.lastIndexOf(open === '{' ? '}' : ']')
    if (end <= i) continue
    try {
      return JSON.parse(text.slice(i, end + 1))
    } catch {
      // 안내 줄의 괄호였다. 다음 후보를 본다.
    }
  }
  return undefined
}

const ROLES: readonly Role[] = ['rule-checker', 'explorer', 'verifier', 'fixer']

export function roleOf(subagentType: string): Role | null {
  const [plugin, name, ...more] = subagentType.split(':')
  if (plugin !== 'anetos-review' || more.length > 0) return null
  return ROLES.find(r => r === name) ?? null
}

export function modeOf(prompt: string): string {
  return /mode\s*:\s*[`"']?(recheck|candidate|tests|fix)\b/i.exec(prompt)?.[1]?.toLowerCase() ?? ''
}

export function taskLabel(role: Role, mode: string): string {
  if (role === 'rule-checker') return '규칙 검사'
  if (role === 'explorer') return '자유 탐색'
  if (role === 'verifier') return mode === 'recheck' ? '지적 재확인' : mode === 'candidate' ? '후보 검증' : '검증'
  return mode === 'tests' ? '테스트 작성' : mode === 'fix' ? '수정' : '수정 작업'
}

const STAGES: Record<FlowKind, readonly (readonly [string, string])[]> = {
  review: [
    ['load', '불러오기'],
    ['recheck', '기존 지적 재확인'],
    ['rules', '규칙 검사'],
    ['explore', '자유 탐색'],
    ['verify', '후보 검증'],
    ['apply', '원장 갱신'],
  ],
  fix: [
    ['baseline', '기준선'],
    ['tests', '테스트 작성'],
    ['red', '빨강 확인'],
    ['fix', '수정'],
    ['recheck', '지적 재확인'],
    ['green', '초록 확인'],
    ['commit', '커밋'],
  ],
}

const LEVELS = ['reproduced', 'guarded', 'unverified']

function newFlow(kind: FlowKind, title: string, at: number): Flow {
  return {
    kind,
    title,
    detail: '',
    findingId: '',
    stages: STAGES[kind].map(([key, label]) => ({ key, label, status: 'pending', tries: 0, note: '' })),
    outcome: 'running',
    summary: '',
    startedAt: at,
  }
}

const isRunning = (flow: Flow | null): flow is Flow => flow !== null && flow.outcome === 'running'

function setStage(flow: Flow, key: string, patch: Partial<Stage>): Flow {
  const index = flow.stages.findIndex(s => s.key === key)
  if (index === -1) return flow
  const isActive = patch.status !== undefined && patch.status !== 'pending' && patch.status !== 'skipped'
  return {
    ...flow,
    stages: flow.stages.map((s, i) => {
      if (i === index) return { ...s, ...patch }
      // 수정 흐름은 순서대로만 간다. 뒤 단계가 움직였는데 아직 대기인 앞 단계는 건너뛴 것이다.
      if (flow.kind === 'fix' && isActive && i < index && s.status === 'pending') return { ...s, status: 'skipped' }
      return s
    }),
  }
}

const stageOf = (flow: Flow, key: string): Stage | undefined => flow.stages.find(s => s.key === key)

function finish(flow: Flow, outcome: Flow['outcome'], summary: string, at: number): Flow {
  const settle = (status: StageStatus): StageStatus => {
    if (status === 'pending') return 'skipped'
    if (status === 'running') return outcome === 'aborted' ? 'failed' : 'done'
    if (status === 'retry') return 'failed'
    return status
  }
  return {
    ...flow,
    stages: flow.stages.map(s => ({ ...s, status: settle(s.status) })),
    outcome,
    summary,
    endedAt: at,
  }
}

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

const COUNTS: readonly (readonly [string, string])[] = [
  ['new', '신규'],
  ['stillOpen', '열림'],
  ['resolved', '해결'],
  ['recurred', '재발'],
  ['reopenRequested', '재검토 요청'],
  ['decided', '결정 유지'],
  ['dismissed', '기각'],
]

function reviewSummary(data: unknown): string {
  const d = record(data)
  const parts = COUNTS.map(([key, label]) => [label, Array.isArray(d[key]) ? (d[key] as unknown[]).length : 0] as const)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}`)
  return parts.length ? parts.join(' · ') : '지적 없음'
}

// 판정 단계(빨강 확인, 초록 확인)의 결과를 단계에 반영한다.
function judged(flow: Flow, key: string, ev: Extract<FlowEvent, { type: 'script' }>, passedNote: (d: Record<string, unknown>) => string): Flow {
  const tries = (stageOf(flow, key)?.tries ?? 0) + 1
  const d = record(ev.data)
  if (ev.data === undefined) {
    return setStage(flow, key, ev.ok ? { status: 'done', tries, note: '결과 알 수 없음' } : { status: 'failed', tries, note: '실행 실패' })
  }
  if (d.ok === true) {
    const note = passedNote(d) || (tries > 1 ? `${tries}번째에 통과` : '')
    return setStage(flow, key, { status: 'done', tries, note })
  }
  return setStage(flow, key, { status: 'retry', tries, note: strings(d.reasons).join(', ') })
}

function onLedger(flow: Flow | null, ev: Extract<FlowEvent, { type: 'script' }>): Flow | null {
  const { sub } = ev.call
  if (sub === 'init') {
    return setStage(newFlow('review', '리뷰', ev.at), 'load', { status: 'running' })
  }
  if (sub === 'list') {
    if (!isRunning(flow) || flow.kind !== 'fix' || !Array.isArray(ev.data)) return flow
    const found = ev.data.map(record).find(f => f.id === flow.findingId)
    return found && text(found.title) ? { ...flow, detail: text(found.title) } : flow
  }
  if (sub === 'apply') {
    const base = isRunning(flow) && flow.kind === 'review' ? flow : newFlow('review', '리뷰', ev.at)
    const tries = (stageOf(base, 'apply')?.tries ?? 0) + 1
    if (!ev.ok) return setStage(base, 'apply', { status: 'failed', tries, note: '원장 갱신 실패' })
    return finish(setStage(base, 'apply', { status: 'done', tries, note: '' }), 'done', reviewSummary(ev.data), ev.at)
  }
  return flow
}

function onFix(flow: Flow | null, ev: Extract<FlowEvent, { type: 'script' }>): Flow | null {
  const { sub, args } = ev.call
  const d = record(ev.data)

  if (sub === 'start') {
    if (!ev.ok) return flow
    const id = args[0] ?? text(d.id)
    const masked = strings(d.masked)
    const started = { ...newFlow('fix', id ? `수정 ${id}` : '수정', ev.at), findingId: id }
    return setStage(started, 'baseline', { status: 'done', tries: 1, note: masked.length ? `가려진 검사: ${masked.join(', ')}` : '' })
  }

  if (sub === 'abort') {
    if (d.aborted === false || !isRunning(flow) || flow.kind !== 'fix') return flow
    const stopped = flow.stages.find(s => (s.status === 'retry' || s.status === 'failed') && s.note)
    return finish(flow, 'aborted', stopped ? `중단됨 · ${stopped.note}` : '중단됨', ev.at)
  }

  if (sub !== 'stage red' && sub !== 'stage fixed' && sub !== 'finish') return flow
  const base = isRunning(flow) && flow.kind === 'fix' ? flow : newFlow('fix', '수정', ev.at)

  if (sub === 'stage red') return judged(base, 'red', ev, () => '')

  if (sub === 'stage fixed') {
    return judged(base, 'green', ev, r => {
      const out = Array.isArray(r.outOfScope) ? r.outOfScope.length : 0
      return [text(r.level), out ? `범위 밖 ${out}개` : ''].filter(Boolean).join(' · ')
    })
  }

  const tries = (stageOf(base, 'commit')?.tries ?? 0) + 1
  if (!ev.ok) return setStage(base, 'commit', { status: 'failed', tries, note: '커밋 실패' })
  const commit = text(d.commit)
  const fromGreen = (stageOf(base, 'green')?.note ?? '').split(' · ')[0] ?? ''
  const level = text(d.level) || (LEVELS.includes(fromGreen) ? fromGreen : '')
  const summary = commit ? [`커밋 ${commit}`, level].filter(Boolean).join(' · ') : ['커밋됨', level].filter(Boolean).join(' · ')
  return finish(setStage(base, 'commit', { status: 'done', tries, note: commit }), 'committed', summary, ev.at)
}

// 에이전트가 맡은 단계. 그 흐름에 없는 조합이면 undefined.
function stageKeyOf(flow: Flow, role: Role, mode: string): string | undefined {
  if (flow.kind === 'fix') {
    if (role === 'verifier') return 'recheck'
    if (role !== 'fixer') return undefined
    if (mode === 'tests' || mode === 'fix') return mode
    return stageOf(flow, 'tests')?.status === 'pending' ? 'tests' : 'fix'
  }
  if (role === 'rule-checker') return 'rules'
  if (role === 'explorer') return 'explore'
  if (role !== 'verifier') return undefined
  if (mode === 'recheck') return 'recheck'
  if (mode === 'candidate') return 'verify'
  return stageOf(flow, 'explore')?.status === 'pending' ? 'recheck' : 'verify'
}

export function reduce(flow: Flow | null, ev: FlowEvent): Flow | null {
  if (ev.type === 'script') return ev.call.script === 'ledger' ? onLedger(flow, ev) : onFix(flow, ev)

  if (ev.type === 'agent-start') {
    // 흐름의 시작을 놓쳤어도 에이전트가 시작되면 그 흐름으로 본다.
    const base = isRunning(flow) ? flow : ev.role === 'fixer' ? newFlow('fix', '수정', ev.at) : newFlow('review', '리뷰', ev.at)
    const key = stageKeyOf(base, ev.role, ev.mode)
    if (!key) return flow
    const loaded = base.kind === 'review' ? setStage(base, 'load', { status: 'done' }) : base
    return setStage(loaded, key, { status: 'running' })
  }

  if (!isRunning(flow) || ev.isRoleStillRunning) return flow
  const key = stageKeyOf(flow, ev.role, ev.mode)
  return key && stageOf(flow, key)?.status === 'running' ? setStage(flow, key, { status: 'done' }) : flow
}

export function progress(flow: Flow | null): { done: number; total: number } {
  if (!flow) return { done: 0, total: 0 }
  return {
    done: flow.stages.filter(s => s.status === 'done' || s.status === 'skipped').length,
    total: flow.stages.length,
  }
}

// 진행 바 가운데에 쓰는 글자: 지금 진행 중인 단계들, 끝났으면 결과.
export function activeLabel(flow: Flow | null): string {
  if (!flow) return ''
  if (flow.outcome !== 'running') return flow.summary
  const active = flow.stages
    .filter(s => s.status === 'running' || s.status === 'retry' || s.status === 'failed')
    .map(s => (s.status === 'retry' ? `${s.label} (재시도 ${s.tries})` : s.status === 'failed' ? `${s.label} 실패` : s.label))
  return active.length ? active.join(' · ') : '대기 중'
}
