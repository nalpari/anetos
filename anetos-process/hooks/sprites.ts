// 에이전트 캐릭터. 30×18칸 격자에 사각형으로 찍는다. 엔진을 쓰지 않는 순수 함수만 둔다.
import type { AgentStatus, Role } from '../types'

export type SpriteState = AgentStatus | 'pending'

export const GRID_W = 30
export const GRID_H = 18

const CLAY = '#D97757'
const GREY = '#9a9892'
const INK = '#1F1E1D'
const WOOD = '#8a6d4b'
const PAPER = '#f7f4ec'
const GREEN = '#1D9E75'
const RED = '#E24B4A'
const AMBER = '#EF9F27'

const R = (x: number, y: number, w: number, h: number, fill: string): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`

const G = (cls: string, inner: string): string => `<g class="${cls}">${inner}</g>`

// 모든 움직임. 길이 단위(px)는 격자 한 칸이다: 캐릭터가 scale 된 <g> 안에 있기 때문이다.
export const SPRITE_CSS = `<style>
.abd{animation:abob .7s steps(2) infinite}@keyframes abob{50%{transform:translateY(-1px)}}
.ala,.alb{animation:aleg .36s steps(1) infinite}.alb{animation-delay:-.18s}@keyframes aleg{50%{transform:translateY(-1px)}}
.aey{transform-box:fill-box;transform-origin:center;animation:abl 3.6s steps(1) infinite}@keyframes abl{0%,93%{transform:scaleY(1)}94%,100%{transform:scaleY(.1)}}
.ak1{animation:at1 2.4s steps(1) infinite}.ak2{animation:at2 2.4s steps(1) infinite}.ak3{animation:at3 2.4s steps(1) infinite}
@keyframes at1{0%{opacity:0}20%,100%{opacity:1}}@keyframes at2{0%{opacity:0}45%,100%{opacity:1}}@keyframes at3{0%{opacity:0}70%,100%{opacity:1}}
.abm{transform-origin:23px 10px;animation:asw 2.2s ease-in-out infinite}@keyframes asw{0%,100%{transform:rotate(-14deg);opacity:.9}50%{transform:rotate(14deg);opacity:.55}}
.ast{animation:astp 1.4s ease-in infinite}@keyframes astp{0%,35%{transform:translateY(0)}50%,62%{transform:translateY(5px)}80%,100%{transform:translateY(0)}}
.asl{animation:asel 1.4s steps(1) infinite}@keyframes asel{0%{opacity:0}50%,100%{opacity:1}}
.ahm{transform-origin:18px 10px;animation:ahit .8s ease-in infinite}@keyframes ahit{0%,100%{transform:rotate(-25deg)}55%,70%{transform:rotate(30deg)}}
.asp{animation:aspk .8s steps(1) infinite}@keyframes aspk{0%{opacity:0}55%{opacity:1}75%,100%{opacity:0}}
.aoff,.aoff *{animation:none!important}
@media (prefers-reduced-motion:reduce){.abd,.ala,.alb,.aey,.ak1,.ak2,.ak3,.abm,.ast,.asl,.ahm,.asp{animation:none}}
</style>`

// 역할마다 모자(또는 안경)와 소품. 몸통과 함께 들썩인다.
function costume(role: Role): string {
  if (role === 'rule-checker') {
    // 초록 챙모자와 클립보드: 체크가 위에서부터 하나씩 채워진다.
    return (
      R(5, 5, 12, 1, GREEN) +
      R(3, 6, 3, 1, GREEN) +
      R(19, 4, 5, 8, WOOD) +
      R(20, 5, 3, 6, PAPER) +
      R(21, 3, 1, 2, '#5f5e5a') +
      G('ak1', R(20, 6, 1, 1, GREEN)) +
      R(21, 6, 2, 1, '#c9c6bd') +
      G('ak2', R(20, 8, 1, 1, GREEN)) +
      R(21, 8, 2, 1, '#c9c6bd') +
      G('ak3', R(20, 10, 1, 1, GREEN)) +
      R(21, 10, 2, 1, '#c9c6bd')
    )
  }
  if (role === 'explorer') {
    // 탐험 모자와 손전등: 불빛이 좌우로 훑는다.
    return (
      R(7, 3, 8, 2, '#c9a15f') +
      R(7, 4, 8, 1, WOOD) +
      R(3, 5, 16, 1, '#b08a4f') +
      R(19, 9, 3, 2, '#5f5e5a') +
      R(22, 8, 1, 4, '#888780') +
      G('abm', '<polygon points="23,9 29,5 29,15 23,11" fill="#FAC775"/>')
    )
  }
  if (role === 'verifier') {
    // 외알 안경과 도장: 내려찍히면 종이에 붉은 인장이 남는다.
    return (
      R(13, 7, 3, 1, '#BA7517') +
      R(13, 10, 3, 1, '#BA7517') +
      R(13, 8, 1, 2, '#BA7517') +
      R(15, 8, 1, 2, '#BA7517') +
      R(16, 11, 1, 1, '#BA7517') +
      R(18, 13, 8, 2, PAPER) +
      R(18, 15, 8, 1, '#c9c6bd') +
      G('asl', R(21, 13, 2, 1, RED)) +
      G('ast', R(21, 2, 2, 4, WOOD) + R(19, 6, 6, 2, '#A32D2D'))
    )
  }
  // 수리공: 안전모와 망치. 내리치면 불꽃이 튄다.
  return (
    R(7, 3, 8, 1, AMBER) +
    R(6, 4, 10, 1, AMBER) +
    R(4, 5, 14, 1, '#BA7517') +
    G('ahm', R(19, 8, 1, 1, WOOD) + R(20, 7, 1, 1, WOOD) + R(21, 6, 1, 1, WOOD) + R(22, 5, 1, 1, WOOD) + R(21, 2, 4, 3, '#888780')) +
    G('asp', R(26, 9, 1, 1, AMBER) + R(27, 7, 1, 1, AMBER) + R(27, 11, 1, 1, AMBER))
  )
}

function badge(state: SpriteState): string {
  if (state === 'done') {
    return R(24, 0, 5, 5, GREEN) + R(25, 2, 1, 1, '#fff') + R(26, 3, 1, 1, '#fff') + R(27, 2, 1, 1, '#fff') + R(28, 1, 1, 1, '#fff')
  }
  if (state === 'failed') {
    return (
      R(24, 0, 5, 5, RED) +
      R(25, 1, 1, 1, '#fff') +
      R(27, 1, 1, 1, '#fff') +
      R(26, 2, 1, 1, '#fff') +
      R(25, 3, 1, 1, '#fff') +
      R(27, 3, 1, 1, '#fff')
    )
  }
  return ''
}

/**
 * 캐릭터 하나를 SVG 조각(<g>)으로 돌려준다. 이 조각을 넣는 SVG 는 SPRITE_CSS 를 한 번 포함해야 한다.
 * (x, y) 는 왼쪽 위, cell 은 격자 한 칸의 크기(px)다.
 */
export function sprite(role: Role, state: SpriteState, x: number, y: number, cell: number): string {
  const body = state === 'failed' ? GREY : CLAY
  const legs =
    G('ala', R(6, 13, 1, 2, body) + R(13, 13, 1, 2, body)) + G('alb', R(8, 13, 1, 2, body) + R(15, 13, 1, 2, body))
  const torso =
    R(5, 6, 12, 7, body) + R(3, 9, 2, 2, body) + R(17, 9, 2, 2, body) + G('aey', R(7, 8, 1, 2, INK) + R(14, 8, 1, 2, INK))
  const cls = state === 'running' ? 'asprite' : 'asprite aoff'
  const opacity = state === 'pending' ? ' opacity="0.4"' : ''
  return `<g class="${cls}" transform="translate(${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}) scale(${cell})" shape-rendering="crispEdges"${opacity}>${legs}${G('abd', torso + costume(role))}${badge(state)}</g>`
}
