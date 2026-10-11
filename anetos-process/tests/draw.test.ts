import { describe, expect, test } from 'claude-code/testing'

import {
  agentSvg,
  bandSvg,
  barText,
  fitText,
  fmtTime,
  fmtTokens,
  headerSvg,
  modelName,
  stagesSvg,
  textWidth,
  xml,
} from '../hooks/draw'
import { reduce } from '../hooks/flow'
import type { FlowEvent } from '../hooks/flow'
import { SPRITE_CSS, sprite } from '../hooks/sprites'
import type { SpriteState } from '../hooks/sprites'
import type { AgentRun, Flow, Role } from '../types'

const ROLES: readonly Role[] = ['rule-checker', 'explorer', 'verifier', 'fixer']
const STATES: readonly SpriteState[] = ['running', 'done', 'failed', 'pending']
const SVG_LIMIT = 131072

const flowOf = (events: FlowEvent[]): Flow => {
  const flow = events.reduce<Flow | null>((f, ev) => reduce(f, ev), null)
  if (!flow) throw new Error('흐름이 만들어지지 않았다')
  return flow
}

const fixFlow = (): Flow =>
  flowOf([
    { type: 'script', call: { script: 'fix', sub: 'start', args: ['F-c6e90533'] }, ok: true, data: { masked: ['lint'] }, at: 0 },
    { type: 'agent-start', role: 'fixer', mode: 'tests', at: 10 },
    { type: 'agent-end', role: 'fixer', mode: 'tests', isRoleStillRunning: false, at: 20 },
    {
      type: 'script',
      call: { script: 'fix', sub: 'stage red', args: [] },
      ok: true,
      data: { ok: false, reasons: ['repro-not-failing'] },
      at: 30,
    },
  ])

const agent = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'a1',
  agentId: 'a1',
  role: 'verifier',
  mode: 'candidate',
  description: '할인율 계산 <검증> & "확인"',
  model: 'claude-opus-5-5-20260101',
  status: 'running',
  startedAt: 1000,
  tokens: 45200,
  contextTokens: 12000,
  ...over,
})

describe('캐릭터', () => {
  test('모든 역할과 상태가 조각을 돌려준다', () => {
    for (const role of ROLES) {
      for (const state of STATES) {
        const g = sprite(role, state, 3, 4, 2)
        expect(g).toStartWith('<g ')
        expect(g).toEndWith('</g>')
        expect(g).toContain('translate(3,4) scale(2)')
        expect(g.length).toBeLessThan(4000)
      }
    }
  })

  test('실행 중일 때만 움직인다', () => {
    for (const role of ROLES) {
      expect(sprite(role, 'running', 0, 0, 1)).not.toContain('aoff')
      for (const state of ['done', 'failed', 'pending'] as const) {
        expect(sprite(role, state, 0, 0, 1)).toContain('aoff')
      }
    }
    expect(SPRITE_CSS).toContain('.aoff,.aoff *{animation:none!important}')
    expect(SPRITE_CSS).toContain('prefers-reduced-motion')
  })

  test('역할마다 그림이 다르고 상태가 배지와 색으로 드러난다', () => {
    const running = ROLES.map(role => sprite(role, 'running', 0, 0, 1))
    expect(new Set(running).size).toBe(4)
    expect(sprite('fixer', 'done', 0, 0, 1)).toContain('#1D9E75')
    expect(sprite('fixer', 'failed', 0, 0, 1)).toContain('#E24B4A')
    expect(sprite('fixer', 'failed', 0, 0, 1)).not.toContain('#D97757')
    expect(sprite('fixer', 'pending', 0, 0, 1)).toContain('opacity="0.4"')
  })
})

describe('글자 다듬기', () => {
  test('한글은 한 칸, 좁은 글자는 좁게 센다', () => {
    expect(textWidth('가나다', 10)).toBe(30)
    expect(textWidth('ill', 10)).toBeLessThan(textWidth('WWW', 10))
  })

  test('넘치면 말줄임표를 붙여 자른다', () => {
    expect(fitText('짧다', 12, 200)).toBe('짧다')
    const cut = fitText('아주 긴 제목이 여기에 들어간다', 12, 60)
    expect(cut).toEndWith('…')
    expect(textWidth(cut, 12)).toBeLessThanOrEqual(60)
  })

  test('시간, 토큰, 모델 이름', () => {
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(65_000)).toBe('1:05')
    expect(fmtTime(3_725_000)).toBe('1:02:05')
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(45_200)).toBe('45k')
    expect(fmtTokens(1_250_000)).toBe('1.3M')
    expect(modelName('claude-opus-5-5-20260101')).toBe('Opus 5.5')
    expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelName('haiku')).toBe('haiku')
    expect(modelName('')).toBe('—')
  })

  test('SVG 에 넣는 글자를 이스케이프한다', () => {
    expect(xml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;')
  })
})

describe('데스크톱 그림', () => {
  test('진행 바: 제목, 단계 칸, 진행 중인 단계, 진행률이 들어간다', () => {
    const flow = fixFlow()
    for (const W of [320, 480, 1200]) {
      const out = bandSvg(flow, W, 'fixer')
      expect(out).toStartWith('<svg ')
      expect(out).toContain(`width="${W}"`)
      expect(out).toContain('수정 F-c6e90533')
      expect(out).toContain('2/7')
      expect(out.length).toBeLessThan(SVG_LIMIT)
    }
    const wide = bandSvg(flow, 900, 'fixer')
    expect(wide).toContain('빨강 확인 (재시도 1)')
    expect(wide).toContain('asprite')
    expect(wide.split('<rect').length - 1).toBeGreaterThanOrEqual(7)
  })

  test('진행 바: 일하는 에이전트가 없으면 캐릭터를 그리지 않는다', () => {
    const out = bandSvg(fixFlow(), 600, null)
    expect(out).not.toContain('asprite')
    expect(out).not.toContain('@keyframes abob')
  })

  test('단계 목록: 모든 단계와 한 줄 결과가 들어간다', () => {
    const out = stagesSvg(fixFlow(), 420)
    for (const label of ['기준선', '테스트 작성', '빨강 확인', '수정', '지적 재확인', '초록 확인', '커밋']) {
      expect(out).toContain(label)
    }
    expect(out).toContain('가려진 검사: lint')
    expect(out).toContain('repro-not-failing')
    expect(out.length).toBeLessThan(SVG_LIMIT)
  })

  test('에이전트 한 줄: 하는 일, 모델, 시간, 토큰이 들어가고 설명은 이스케이프된다', () => {
    const out = agentSvg(agent(), 480, 66_000)
    expect(out).toContain('후보 검증')
    expect(out).toContain('&lt;검증&gt; &amp; &quot;확인&quot;')
    expect(out).toContain('Opus 5.5')
    expect(out).toContain('1:05')
    expect(out).toContain('45k 토큰')
    expect(out).toContain('asprite')
    expect(out.length).toBeLessThan(SVG_LIMIT)
    expect(agentSvg(agent({ status: 'done', endedAt: 31_000 }), 480, 999_000)).toContain('0:30')
  })

  test('머리: 흐름이 없어도 그려진다', () => {
    expect(headerSvg(null, 300, '0:00 · 0 토큰')).toContain('anetos-review')
    const withDetail = headerSvg({ ...fixFlow(), detail: '할인율을 10으로 나눔' }, 300, '1:05 · 45k 토큰')
    expect(withDetail).toContain('할인율을 10으로 나눔')
    expect(withDetail).toContain('height="44"')
  })
})

describe('터미널 글자', () => {
  test('진행 바는 끝난 단계만큼 채운다', () => {
    const flow = fixFlow()
    expect(barText(flow, 14)).toBe('████░░░░░░░░░░')
    expect(barText(flow, 14)).toHaveLength(14)
  })
})
