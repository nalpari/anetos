export type StageStatus = 'pending' | 'running' | 'retry' | 'done' | 'failed' | 'skipped'

export type Stage = {
  key: string
  label: string
  status: StageStatus
  /** 판정 단계(빨강 확인, 초록 확인, 원장 갱신, 커밋)를 실행한 횟수. */
  tries: number
  /** 한 줄 결과: "가려진 검사: lint", "repro-not-failing", "reproduced" 등. */
  note: string
}

export type FlowKind = 'review' | 'fix'

export type FlowOutcome = 'running' | 'done' | 'committed' | 'aborted'

export type Flow = {
  kind: FlowKind
  /** "리뷰" 또는 "수정 F-xxxxxxxx". */
  title: string
  /** 수정이면 지적의 제목. */
  detail: string
  /** 수정이면 지적 ID. */
  findingId: string
  stages: Stage[]
  outcome: FlowOutcome
  /** 흐름이 끝났을 때의 한 줄 결과. */
  summary: string
  startedAt: number
  endedAt?: number
}

export type Role = 'rule-checker' | 'explorer' | 'verifier' | 'fixer'

export type AgentStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  role: Role
  /** '', 'recheck', 'candidate', 'tests', 'fix'. */
  mode: string
  /** Agent 도구의 description. */
  description: string
  model: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  tokens: number
  contextTokens: number
}

export type Panel = {
  isDoneCollapsed: boolean
  autoOpenedFor: string
}

declare module 'claude-code' {
  interface PluginState {
    'anetos-process': {
      flow: Flow | null
      agents: AgentRun[]
      panel: Panel
      now: number
    }
  }
}
