import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  AGENT_ROW_H,
  BAND_H,
  CLAY,
  GREEN,
  RED,
  STATUS_GLYPH,
  agentSvg,
  bandSvg,
  barText,
  elapsed,
  flowColor,
  fmtTime,
  fmtTokens,
  headerHeight,
  headerSvg,
  modelName,
  stagesHeight,
  stagesSvg,
  statusColor,
} from './draw'
import { activeLabel, modeOf, parseCommands, parseJson, progress, reduce, roleOf, taskLabel } from './flow'
import type { FlowEvent, ScriptCall } from './flow'
import type { AgentRun, Flow, Panel } from '../types'

const flow = atom({ plugin: 'anetos-process', key: 'flow' } as const, null)
const agents = atom({ plugin: 'anetos-process', key: 'agents' } as const, [])
const panel = atom({ plugin: 'anetos-process', key: 'panel' } as const, {
  isDoneCollapsed: false,
  autoOpenedFor: '',
})
const now = atom({ plugin: 'anetos-process', key: 'now' } as const, 0)

const PANE = 'anetos-process'
const PANE_TITLE = 'anetos-review'
const EMPTY = '아직 실행된 리뷰가 없습니다.'

// 패널을 열거나, 열려 있으면 닫는다. 열린 채로 끝나면 true.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, now, () => at)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
  return true
}

// 흐름마다 한 번만 스스로 연다. 사용자가 닫으면 그 흐름에서는 다시 열지 않는다.
async function autoOpen($: EngineInterface, key: string): Promise<void> {
  const p = await read($, panel)
  if (p.autoOpenedFor === key) return
  await update($, panel, prev => ({ ...prev, autoOpenedFor: key }))
  void $.ui.open({ id: PANE, title: PANE_TITLE })
}

// 사건 하나를 흐름에 반영한다. 새 흐름이 시작됐으면 지난 흐름의 끝난 에이전트를 치우고 패널을 연다.
async function applyEvent($: EngineInterface, ev: FlowEvent): Promise<void> {
  const before = await read($, flow)
  const after = await update($, flow, prev => reduce(prev, ev))
  await update($, now, () => ev.at)
  if (!after || (before && before.startedAt === after.startedAt && before.kind === after.kind)) return
  await update($, agents, list => list.filter(a => a.status === 'running'))
  await autoOpen($, `${after.kind}:${after.startedAt}`)
}

const firstLine = (s: string): string => s.trim().split(/\r?\n/)[0]?.slice(0, 160) ?? ''

type ToolAnswer = { deny?: unknown; isError?: unknown; result?: unknown; text?: unknown }

// 스크립트 호출의 결과를 읽어 흐름에 반영한다.
async function observe($: EngineInterface, calls: ScriptCall[], ran: ToolAnswer): Promise<void> {
  const result = (ran.result ?? {}) as { stdout?: unknown; stderr?: unknown }
  const stdout = typeof result.stdout === 'string' ? result.stdout : typeof ran.text === 'string' ? ran.text : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr : ''
  const hasFailed =
    ran.deny !== undefined || ran.isError === true || (stdout.trim() === '' && stderr.trim() !== '')
  // 한 호출에 명령이 여럿이면 출력이 섞이므로 결과는 읽지 않는다.
  const data = calls.length === 1 && !hasFailed ? parseJson(stdout) : undefined
  const at = await $.clock.now()

  for (const call of calls) {
    if (call.script === 'fix' && call.sub === 'start' && hasFailed) {
      $.ui.toast(`수정을 시작하지 못했습니다: ${firstLine(stderr) || '오류 메시지 없음'}`)
    }
    await applyEvent($, { type: 'script', call, ok: !hasFailed, data, at })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'anetos-process',
      description: 'anetos-review 의 단계와 에이전트를 보여 주는 패널을 열거나 닫는다',
    })
    // 실행 중인 에이전트가 있을 때만 시계를 움직인다.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (!list.some(a => a.status === 'running')) return
        const at = await $.clock.now()
        await update($, now, () => at)
      })()
    })
    return started
  })

  on('command.run', { command: 'anetos-process' }, async $ => {
    const isOpen = await togglePane($)
    return { text: isOpen ? '패널을 열었습니다.' : '패널을 닫았습니다.' }
  })

  // 읽기만 한다: 호출은 그대로 실행하고 결과도 그대로 돌려준다.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool !== 'Bash' && tool !== 'PowerShell') return next(e)
    const command = (e as { command?: unknown }).command
    const calls = typeof command === 'string' ? parseCommands(command) : []
    if (calls.length === 0) return next(e)

    const ran = await next(e)
    try {
      await observe($, calls, ran as ToolAnswer)
    } catch {
      // 표시가 틀리는 것으로 끝나야 한다. 도구 호출의 결과는 건드리지 않는다.
    }
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const role = roleOf(e.subagentType)
    if (started.deny !== undefined || !role) return started

    try {
      const at = await $.clock.now()
      const mode = modeOf(e.prompt)
      // 흐름을 먼저 반영한다: 새 흐름이면 지난 에이전트를 치운 뒤에 이 에이전트를 넣어야 한다.
      await applyEvent($, { type: 'agent-start', role, mode, at })
      const run: AgentRun = {
        id: started.agentId ?? e.tool_use_id,
        agentId: started.agentId,
        role,
        mode,
        description: e.description,
        model: started.model,
        status: 'running',
        startedAt: at,
        tokens: 0,
        contextTokens: 0,
      }
      await update($, agents, list => [...list.filter(a => a.id !== run.id), run].slice(-100))
    } catch {
      // 위와 같다.
    }
    return started
  })

  // 서브에이전트의 모델 요청마다: 모델과 토큰.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result

    const used =
      (usage.input_tokens || 0) +
      (usage.output_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0)
    await update($, agents, list =>
      list.some(a => a.agentId === agentId)
        ? list.map(a =>
            a.agentId === agentId
              ? { ...a, model: usage.model || e.model || a.model, tokens: a.tokens + used, contextTokens: used }
              : a,
          )
        : list,
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId) {
      try {
        const mine = (await read($, agents)).find(a => a.agentId === agentId)
        if (mine) {
          const at = await $.clock.now()
          const list = await update($, agents, prev =>
            prev.map(a =>
              a.agentId === agentId ? { ...a, status: e.reason === 'answer' ? ('done' as const) : ('failed' as const), endedAt: at } : a,
            ),
          )
          const isRoleStillRunning = (list ?? []).some(
            a => a.status === 'running' && a.role === mine.role && a.mode === mine.mode,
          )
          await applyEvent($, { type: 'agent-end', role: mine.role, mode: mine.mode, isRoleStillRunning, at })
        }
      } catch {
        // 위와 같다.
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const f: Flow | null = await read($, flow)
    const list = await read($, agents)
    const p: Panel = await read($, panel)
    const at = Math.max(await read($, now), ...list.map(a => a.startedAt), f?.startedAt ?? 0)

    const running = list.filter(a => a.status === 'running').reverse()
    const finished = list.filter(a => a.status !== 'running').reverse()
    const tokens = list.reduce((sum, a) => sum + a.tokens, 0)
    const stats = `${fmtTime(f ? elapsed(f, at) : 0)} · ${fmtTokens(tokens)} 토큰`
    const isEmpty = f === null && list.length === 0

    const toggleDone = (
      <Button
        key="done"
        label={`${p.isDoneCollapsed ? '▸' : '▾'} 끝남 · ${finished.length}`}
        plain
        onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))}
      />
    )
    const outcome =
      f && f.outcome !== 'running' ? (
        <Text key="outcome" bold color={f.outcome === 'aborted' ? 'red' : 'green'}>
          {f.summary}
        </Text>
      ) : null

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
      const row = (a: AgentRun) => (
        <Svg
          key={a.id}
          source={agentSvg(a, W, at)}
          alt={`${taskLabel(a.role, a.mode)}: ${modelName(a.model)}, ${a.status === 'running' ? '실행 중' : a.status === 'done' ? '완료' : '실패'}`}
          width={W}
          height={AGENT_ROW_H}
        />
      )
      return (
        <Box flexDirection="column">
          <Svg key="head" source={headerSvg(f, W, stats)} alt={`${f?.title ?? PANE_TITLE}: ${stats}`} width={W} height={headerHeight(f)} />
          {isEmpty && <Text dimColor>{EMPTY}</Text>}
          {f && (
            <Svg
              key="stages"
              source={stagesSvg(f, W)}
              alt={f.stages.map(s => `${s.label} ${STATUS_GLYPH[s.status]}`).join(', ')}
              width={W}
              height={stagesHeight(f)}
            />
          )}
          {outcome}
          {running.length > 0 && (
            <Text key="h-run" dimColor>
              실행 중 · {running.length}
            </Text>
          )}
          {running.map(row)}
          {finished.length > 0 && toggleDone}
          {!p.isDoneCollapsed && finished.map(row)}
        </Box>
      )
    }

    // 터미널: 같은 내용을 글자로.
    const agentRow = (a: AgentRun) => (
      <Box key={a.id} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : CLAY}>
            {a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✗'}
          </Text>
          <Text bold wrap="truncate-end">
            {taskLabel(a.role, a.mode)}
          </Text>
          <Text dimColor wrap="truncate-end">
            {a.description}
          </Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {'  '}
          {modelName(a.model)} · {fmtTime(elapsed(a, at))} · {fmtTokens(a.tokens)} 토큰
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {f?.title ?? PANE_TITLE}
          </Text>
          <Text dimColor>{stats}</Text>
        </Box>
        {f?.detail ? (
          <Text dimColor wrap="truncate-end">
            {f.detail}
          </Text>
        ) : null}
        {isEmpty && <Text dimColor>{EMPTY}</Text>}
        {f && (
          <Box flexDirection="column" marginTop={1}>
            {f.stages.map(s => (
              <Text key={s.key} wrap="truncate-end" dimColor={s.status === 'pending' || s.status === 'skipped'}>
                <Text color={statusColor(s.status)}>{STATUS_GLYPH[s.status]}</Text> {s.label}
                {s.note ? <Text dimColor> {s.note}</Text> : null}
              </Text>
            ))}
          </Box>
        )}
        {outcome}
        <Box flexDirection="column" marginTop={1}>
          {running.length > 0 && <Text dimColor>실행 중 · {running.length}</Text>}
          {running.map(agentRow)}
          {finished.length > 0 && toggleDone}
          {!p.isDoneCollapsed && finished.map(agentRow)}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flow)
    if (f === null || e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const list = await read($, agents)
    const working = list.filter(a => a.status === 'running')
    const { done, total } = progress(f)
    const label = activeLabel(f)

    const crewButton = (
      <Button key="anetos-agents" label={`에이전트 ${working.length}`} plain onPress={() => void togglePane($)} />
    )
    const dismiss = (
      <Button key="anetos-dismiss" label="✕" plain role="dismiss" onPress={() => update($, flow, () => null)} />
    )

    // 터미널의 요소 표에도 Svg 라는 이름은 있지만 아무것도 그리지 않는다. 표면으로 가른다.
    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      // 데스크톱은 나란한 요소를 다음 줄로 넘긴다. 한 줄을 그림 하나로 그리고 버튼 둘만 옆에 둔다.
      const width = Math.max(240, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 150))
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg
            source={bandSvg(f, width, working[working.length - 1]?.role ?? null)}
            alt={`${f.title}: ${label}, ${done}/${total}`}
            width={width}
            height={BAND_H}
          />
          {crewButton}
          {dismiss}
        </Box>
      )
    }

    const cols = e.props.bodyColumns || 80
    const color = flowColor(f) === RED ? 'red' : flowColor(f) === GREEN ? 'green' : CLAY
    const barW = Math.max(6, Math.min(21, Math.floor(cols / 5)))
    return (
      <Box flexDirection="row" gap={2}>
        <Box flexShrink={0}>
          <Text color={color}>{f.outcome === 'running' ? '● ' : f.outcome === 'aborted' ? '✗ ' : '✓ '}</Text>
          <Text wrap="truncate-end">{f.title}</Text>
        </Box>
        <Text color={color}>{barText(f, barW)}</Text>
        <Text bold wrap="truncate-end">
          {label}
        </Text>
        <Text dimColor>
          {done}/{total}
        </Text>
        {crewButton}
        {dismiss}
      </Box>
    )
  })
}
