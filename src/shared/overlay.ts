// src/shared/overlay.ts
// O que o painel dentro do jogo mostra: a próxima habilidade a evoluir e a sequência de itens da build, a partir
// dos dados da partida em andamento (Live Client Data API da Riot: só o que o próprio jogador já vê).
import type { ChampionBuild, SkillKey } from './dataTypes'
import type { Role } from './types'

export type OverlayCorner = 'tl' | 'tr' | 'bl' | 'br'

/** Retrato da partida em andamento, já limpo (sem nada de outros jogadores além do necessário). */
export interface LiveSnapshot {
  /** segundos desde o início */
  gameTime: number
  /** nível do campeão do jogador */
  level: number
  /** nível atual de cada habilidade */
  abilities: Record<'Q' | 'W' | 'E' | 'R', number>
  /** ouro atual do jogador (só o dele) */
  gold?: number
  /** campeões do time inimigo (id do Data Dragon, ex.: "Zed"); a escalação é pública na partida */
  enemyKeys?: string[]
  /** itens que o jogador carrega agora (ids) */
  items: number[]
  /** id interno do campeão no Data Dragon (ex.: "Ahri"); null se não deu para ler */
  championKey: string | null
  championName: string
  /** rota informada pelo jogo; null quando o modo não informa */
  role: Role | null
}

export interface OverlaySkill {
  /** habilidade a evoluir agora (ou a próxima, se ainda não há ponto); null = sem build de habilidades */
  next: SkillKey | null
  /** há ponto de habilidade para gastar neste momento */
  ready: boolean
  /** as 5 seguintes depois da próxima (quando a build tem os 18 níveis) */
  upcoming: SkillKey[]
  /** níveis atuais */
  levels: Record<'Q' | 'W' | 'E' | 'R', number>
  priority: SkillKey[]
}

export interface OverlayItemStep {
  itemId: number
  label: string
  owned: boolean
  /** só nos situacionais escolhidos pelo time inimigo: o que o item resolve */
  reason?: 'armor' | 'magic-resist' | 'penetration'
}

export interface OverlayState {
  championId: number
  championName: string
  role: Role
  level: number
  gameTime: number
  skill: OverlaySkill
  items: OverlayItemStep[]
  /** id do próximo item a comprar (null = todos já comprados) */
  nextItemId: number | null
  /** poucas partidas por trás da build */
  lowData: boolean
  /** ouro atual do jogador */
  gold?: number
  /** é uma demonstração (botão de testar nas Configurações) */
  demo?: boolean
  /** versão recuada: só o próximo item (e a habilidade, quando há ponto) */
  compact?: boolean
  /** contra o time inimigo desta partida: o que priorizar e a divisão do dano */
  matchup?: { focus: 'armor' | 'magic-resist' | 'penetration' | null; physical: number; magic: number } | null
  /** modo "mover": o painel aceita arrastar e mostra o botão de salvar a posição */
  editing?: boolean
}

const ORDER: ('Q' | 'W' | 'E' | 'R')[] = ['Q', 'W', 'E', 'R']
/** Itens iniciais só aparecem no começo da partida. */
const STARTING_UNTIL_S = 150
const LOW_DATA_BELOW = 40

/** A habilidade pode receber ponto agora? (nível mínimo do campeão para cada ponto) */
export function canLevel(key: 'Q' | 'W' | 'E' | 'R', current: number, level: number): boolean {
  if (key === 'R') return current < 3 && level >= [6, 11, 16][current]
  return current < 5 && level >= 2 * current + 1
}

/** Próxima habilidade a evoluir: segue a ordem da build, ajustando se o jogador já fugiu dela. */
export function nextSkill(
  skill: ChampionBuild['skillOrder'] | undefined,
  have: Record<'Q' | 'W' | 'E' | 'R', number>,
  level: number
): { next: SkillKey | null; upcoming: SkillKey[]; ready: boolean } {
  if (!skill) return { next: null, upcoming: [], ready: false }
  const spent = ORDER.reduce((n, k) => n + have[k], 0)
  const ready = level - spent > 0
  const levels = skill.levels
  let next: SkillKey | null = null

  if (levels && levels.length === 18) {
    // Quanto cada habilidade deveria ter até o próximo ponto; a maior falta (e permitida) é a escolhida.
    const want: Record<string, number> = { Q: 0, W: 0, E: 0, R: 0 }
    for (const k of levels.slice(0, Math.min(18, spent + 1))) want[k]++
    const planned = levels[Math.min(17, spent)]
    const behind = ORDER.filter((k) => want[k] > have[k] && canLevel(k, have[k], Math.max(level, spent + 1)))
    next = behind.includes(planned as 'Q') ? planned : (behind[0] ?? null)
  }
  if (!next) {
    // Sem os 18 níveis (ou já fora da ordem): prioridade da build, primeira habilidade que pode receber ponto
    const order = skill.priority.filter((k): k is 'Q' | 'W' | 'E' | 'R' => ORDER.includes(k as 'Q'))
    next = order.find((k) => canLevel(k, have[k], Math.max(level, spent + 1))) ?? null
  }
  const upcoming = levels && levels.length === 18 ? levels.slice(spent + 1, spent + 6) : []
  return { next, upcoming: [...upcoming], ready }
}

/** O que o time inimigo desta partida pede (calculado no main com os dados de meta). */
export interface MatchSituation {
  focus: 'armor' | 'magic-resist' | 'penetration' | null
  physical: number
  magic: number
  picks: { itemId: number; reason: 'armor' | 'magic-resist' | 'penetration' }[]
}

export interface OverlayInput {
  championId: number
  role: Role
  build: ChampionBuild
  live: LiveSnapshot
  situation?: MatchSituation | null
}

/** Monta o estado do painel. A build já vem com as opções escolhidas (a mais usada, ou a que foi enviada ao LoL). */
export function computeOverlay(input: OverlayInput): OverlayState {
  const { build, live } = input
  const owned = new Set(live.items)
  const steps: OverlayItemStep[] = []
  if (live.gameTime < STARTING_UNTIL_S) {
    for (const id of build.items.starting) steps.push({ itemId: id, label: 'Inicial', owned: owned.has(id) })
  }
  const [c1, c2, c3] = build.items.core
  const boots = build.items.boots[0]
  if (c1 !== undefined) steps.push({ itemId: c1, label: 'Item 1', owned: owned.has(c1) })
  if (boots !== undefined) steps.push({ itemId: boots, label: 'Botas', owned: owned.has(boots) })
  if (c2 !== undefined) steps.push({ itemId: c2, label: 'Item 2', owned: owned.has(c2) })
  if (c3 !== undefined) steps.push({ itemId: c3, label: 'Item 3', owned: owned.has(c3) })
  // Situacionais: primeiro os que o time inimigo desta partida pede, depois os mais comuns da build
  const sit = input.situation
  const wanted = sit?.picks ?? []
  for (const w of wanted) {
    if (steps.length >= 14 || steps.some((st) => st.itemId === w.itemId)) continue
    steps.push({ itemId: w.itemId, label: 'Situacional', owned: owned.has(w.itemId), reason: w.reason })
  }
  let extra = 0
  for (const s of build.items.situational) {
    if (extra + wanted.length >= 3 || steps.some((st) => st.itemId === s.itemId)) continue
    steps.push({ itemId: s.itemId, label: 'Situacional', owned: owned.has(s.itemId) })
    extra++
  }

  const skillInfo = nextSkill(build.skillOrder, live.abilities, live.level)
  const nextItem = steps.find((s) => !s.owned && s.label !== 'Situacional' && s.label !== 'Inicial')
  return {
    championId: input.championId,
    championName: live.championName,
    role: input.role,
    level: live.level,
    gameTime: live.gameTime,
    gold: live.gold,
    skill: {
      next: skillInfo.next,
      ready: skillInfo.ready,
      upcoming: skillInfo.upcoming,
      levels: { ...live.abilities },
      priority: build.skillOrder?.priority ?? []
    },
    items: steps,
    nextItemId: nextItem?.itemId ?? null,
    matchup: sit && (sit.focus || sit.physical + sit.magic > 0) ? { focus: sit.focus, physical: sit.physical, magic: sit.magic } : null,
    lowData: build.options !== undefined && build.options.timeline > 0 && build.options.timeline < LOW_DATA_BELOW
  }
}
