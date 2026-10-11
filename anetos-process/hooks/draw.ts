// 데스크톱에서 쓰는 SVG 그림과, 두 표면이 함께 쓰는 글자 다듬기. 엔진을 쓰지 않는 순수 함수만 둔다.
import { activeLabel, progress, taskLabel } from './flow'
import { GRID_H, GRID_W, SPRITE_CSS, sprite } from './sprites'
import type { AgentRun, Flow, Role, Stage, StageStatus } from '../types'

export const CLAY = '#D97757'
export const GREEN = '#1D9E75'
export const RED = '#E24B4A'
export const AMBER = '#BA7517'

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI','Malgun Gothic',sans-serif"

const BASE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#e4e4e2}.ln{stroke:#e4e4e1}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}}
.live{animation:alive 1.6s ease-in-out infinite}@keyframes alive{50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// 시스템 글꼴의 글자 폭을 em 으로 어림한다. 한글과 한자는 한 칸을 다 쓴다.
const charEm = (ch: string): number => {
  if (/[ᄀ-ᇿ　-鿿가-힣＀-￯]/.test(ch)) return 1
  if (/[\s.,:;'|!il1()[\]·]/.test(ch)) return 0.3
  if (/[A-Zmw@%]/.test(ch)) return 0.72
  return 0.56
}

export const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

// maxW 픽셀에 들어가게 자르고, 잘랐으면 말줄임표를 붙인다.
export function fitText(s: string, size: number, maxW: number): string {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(`${out}${ch}…`, size) > maxW) break
    out += ch
  }
  return `${out}…`
}

export const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`

export function fmtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const ss = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// 'claude-opus-5-5-20260101' → 'Opus 5.5'. 모르는 형태는 접두사만 뗀다.
export function modelName(id: string): string {
  const m = /([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id.replace(/^claude-/, ''))
  if (!m || !m[1]) return id.replace(/^claude-/, '') || '—'
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

export const elapsed = (a: { startedAt: number; endedAt?: number }, at: number): number =>
  (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

export const flowColor = (flow: Flow): string =>
  flow.outcome === 'aborted' ? RED : flow.outcome === 'running' ? CLAY : GREEN

export const STATUS_GLYPH: Record<StageStatus, string> = {
  pending: '○',
  running: '●',
  retry: '↻',
  done: '✓',
  failed: '✗',
  skipped: '–',
}

export const statusColor = (status: StageStatus): string =>
  status === 'done' ? GREEN : status === 'failed' ? RED : status === 'retry' ? AMBER : status === 'running' ? CLAY : '#9a9a96'

const svg = (W: number, H: number, body: string, withSprites: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${BASE_CSS}${withSprites ? SPRITE_CSS : ''}${body}</svg>`

// 단계 하나가 한 칸인 진행 바. 칸의 색이 그 단계의 상태다.
function segments(stages: readonly Stage[], x: number, y: number, w: number, h: number, color: string): string {
  const gap = 2
  const n = Math.max(1, stages.length)
  const segW = (w - gap * (n - 1)) / n
  return stages
    .map((s, i) => {
      const sx = (x + i * (segW + gap)).toFixed(1)
      const at = `x="${sx}" y="${y}" width="${segW.toFixed(1)}" height="${h}" rx="2"`
      if (s.status === 'done') return `<rect ${at} fill="${color}"/>`
      if (s.status === 'running') return `<rect class="live" ${at} fill="${color}"/>`
      if (s.status === 'retry') return `<rect class="live" ${at} fill="${AMBER}"/>`
      if (s.status === 'failed') return `<rect ${at} fill="${RED}"/>`
      if (s.status === 'skipped') return `<rect ${at} fill="${color}" opacity="0.3"/>`
      return `<rect class="k" ${at}/>`
    })
    .join('')
}

export const BAND_H = 24

/** 프롬프트 위 진행 바 한 줄. role 은 지금 일하는 에이전트의 역할이고, 없으면 캐릭터를 그리지 않는다. */
export function bandSvg(flow: Flow, W: number, role: Role | null): string {
  const color = flowColor(flow)
  const { done, total } = progress(flow)
  const mid = BAND_H / 2
  const spriteCell = 1.2
  const spriteW = role ? Math.ceil(GRID_W * spriteCell) + 6 : 0
  const count = `${done}/${total}`
  const countW = Math.ceil(textWidth(count, 12)) + 8

  const title = fitText(flow.title, 13, Math.max(110, W * 0.3))
  const barX = Math.round(16 + textWidth(title, 13) + 10)
  const barW = Math.max(48, Math.min(180, Math.round(W * 0.24)))
  const labelX = barX + barW + 10
  const labelW = W - labelX - countW - spriteW - 4
  const label = labelW > 40 ? fitText(activeLabel(flow), 12, labelW) : ''
  const mark = flow.outcome === 'running' ? `<circle class="live" cx="6" cy="${mid}" r="4" fill="${color}"/>` : `<circle cx="6" cy="${mid}" r="4" fill="${color}"/>`

  return svg(
    W,
    BAND_H,
    `${mark}
<text class="t" x="16" y="${mid + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
${segments(flow.stages, barX, mid - 5, barW, 10, color)}
<text class="s" x="${labelX}" y="${mid + 4}" font-family="${FONT}" font-size="12">${xml(label)}</text>
<text class="m" x="${W - spriteW - 2}" y="${mid + 4}" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${count}</text>
${role ? sprite(role, 'running', W - spriteW + 4, (BAND_H - GRID_H * spriteCell) / 2, spriteCell) : ''}`,
    role !== null,
  )
}

export const headerHeight = (flow: Flow | null): number => (flow?.detail ? 44 : 26)

/** 패널의 머리: 흐름의 제목과 세부, 걸린 시간과 토큰 합계. */
export function headerSvg(flow: Flow | null, W: number, stats: string): string {
  const H = headerHeight(flow)
  const statsW = Math.ceil(textWidth(stats, 12)) + 8
  const title = fitText(flow?.title ?? 'anetos-review', 14, Math.max(60, W - statsW - 8))
  const detail = flow?.detail ? fitText(flow.detail, 12, W - 4) : ''
  return svg(
    W,
    H,
    `<text class="t" x="0" y="17" font-family="${FONT}" font-size="14" font-weight="600">${xml(title)}</text>
<text class="s" x="${W}" y="17" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${xml(stats)}</text>
${detail ? `<text class="s" x="0" y="36" font-family="${FONT}" font-size="12">${xml(detail)}</text>` : ''}`,
    false,
  )
}

const STAGE_ROW = 20

export const stagesHeight = (flow: Flow): number => flow.stages.length * STAGE_ROW + 4

function stageMark(status: StageStatus, cx: number, cy: number): string {
  const color = statusColor(status)
  if (status === 'done') {
    return `<path d="M${cx - 4} ${cy}l3 3l5 -6" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (status === 'failed') {
    return `<path d="M${cx - 3.5} ${cy - 3.5}l7 7M${cx + 3.5} ${cy - 3.5}l-7 7" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`
  }
  if (status === 'running') return `<circle class="live" cx="${cx}" cy="${cy}" r="4" fill="${color}"/>`
  if (status === 'retry') {
    return `<circle class="live" cx="${cx}" cy="${cy}" r="3.6" fill="none" stroke="${color}" stroke-width="1.8" stroke-dasharray="5 3"/>`
  }
  if (status === 'skipped') return `<rect class="m" x="${cx - 4}" y="${cy - 0.9}" width="8" height="1.8" rx="0.9"/>`
  return `<circle cx="${cx}" cy="${cy}" r="3.6" fill="none" stroke="${color}" stroke-width="1.4"/>`
}

/** 패널의 단계 목록: 단계마다 상태 표시, 이름, 한 줄 결과. */
export function stagesSvg(flow: Flow, W: number): string {
  const rows = flow.stages
    .map((s, i) => {
      const cy = i * STAGE_ROW + STAGE_ROW / 2 + 2
      const quiet = s.status === 'pending' || s.status === 'skipped'
      const labelW = textWidth(s.label, 12.5)
      const tries = s.tries > 1 ? `${s.tries}회` : ''
      const note = [s.note, s.note.includes('번째') ? '' : tries].filter(Boolean).join(' · ')
      const noteX = 22 + labelW + 10
      const noteText = note && W - noteX > 30 ? fitText(note, 11.5, W - noteX) : ''
      return `${stageMark(s.status, 8, cy)}
<text class="${quiet ? 'm' : 't'}" x="22" y="${cy + 4.5}" font-family="${FONT}" font-size="12.5"${s.status === 'running' || s.status === 'retry' ? ' font-weight="600"' : ''}>${xml(s.label)}</text>
${noteText ? `<text class="s" x="${noteX}" y="${cy + 4.5}" font-family="${FONT}" font-size="11.5">${xml(noteText)}</text>` : ''}`
    })
    .join('\n')
  return svg(W, stagesHeight(flow), rows, false)
}

export const AGENT_ROW_H = 46

/** 패널의 에이전트 한 줄: 캐릭터, 하는 일, 모델·시간·토큰, 상태. */
export function agentSvg(a: AgentRun, W: number, at: number): string {
  const cell = 2
  const textX = GRID_W * cell + 8
  const textW = W - textX - 4
  const task = taskLabel(a.role, a.mode)
  const head = a.description && a.description !== task ? `${task} · ${a.description}` : task
  const meta = [modelName(a.model), fmtTime(elapsed(a, at)), `${fmtTokens(a.tokens)} 토큰`].join('  ·  ')
  return svg(
    W,
    AGENT_ROW_H,
    `${sprite(a.role, a.status, 0, 4, cell)}
<text class="t" x="${textX}" y="19" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(head, 13, textW))}</text>
<text class="s" x="${textX}" y="36" font-family="${FONT}" font-size="11.5" font-variant-numeric="tabular-nums">${xml(fitText(meta, 11.5, textW))}</text>
<line class="ln" x1="0" y1="${AGENT_ROW_H - 0.5}" x2="${W}" y2="${AGENT_ROW_H - 0.5}"/>`,
    true,
  )
}

/** 글자만 쓰는 진행 바. width 칸 중 끝난 단계만큼 채운다. */
export function barText(flow: Flow, width: number): string {
  const { done, total } = progress(flow)
  const filled = total ? Math.round((width * done) / total) : 0
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}
