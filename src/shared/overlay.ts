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

/** O que vale comprar AGORA para o item principal, de acordo com o ouro (ex.: 1200 g → Capítulo Perdido). */
export interface PurchaseAdvice {
  targetId: number
  /** ouro que falta para o item inteiro, já descontando as peças que você tem (0 = dá para comprar completo) */
  missing: number
  /** custo restante do item inteiro (descontadas as peças que você já tem) */
  remaining: number
  /** 'full' = compre o item; 'parts' = compre estas peças; 'save' = ainda não dá para nenhuma peça: junte ouro */
  mode: 'full' | 'parts' | 'save'
  /** peças a comprar agora (ou, em 'save', a mais barata a juntar ouro) */
  buy: { itemId: number; cost: number }[]
  /** peças da receita (diretas) e se você já tem */
  parts: { itemId: number; cost: number; owned: boolean }[]
}

/** Dados de receita de um item (do Data Dragon). */
export type RecipeBook = Readonly<Record<string, { goldTotal: number; from?: number[] } | undefined>>

/** Custo para fechar `itemId` com o que já está no inventário (consome `bag`, uma cópia por peça usada). */
function remainingCost(itemId: number, book: RecipeBook, bag: Map<number, number>): number {
  const have = bag.get(itemId) ?? 0
  if (have > 0) {
    bag.set(itemId, have - 1)
    return 0
  }
  const it = book[String(itemId)]
  if (!it) return 0
  const from = it.from ?? []
  if (from.length === 0) return it.goldTotal
  const combine = Math.max(0, it.goldTotal - from.reduce((n, f) => n + (book[String(f)]?.goldTotal ?? 0), 0))
  return combine + from.reduce((n, f) => n + remainingCost(f, book, bag), 0)
}

/** Peças que cabem no ouro, das maiores para as menores; desce para as sub-peças quando a peça inteira não cabe. */
function affordableParts(itemId: number, book: RecipeBook, bag: Map<number, number>, budget: { gold: number }, out: { itemId: number; cost: number }[]): void {
  const from = [...(book[String(itemId)]?.from ?? [])].sort((a, b) => (book[String(b)]?.goldTotal ?? 0) - (book[String(a)]?.goldTotal ?? 0))
  for (const f of from) {
    const have = bag.get(f) ?? 0
    if (have > 0) {
      bag.set(f, have - 1)
      continue
    }
    const cost = remainingCost(f, book, new Map(bag))
    if (cost > 0 && cost <= budget.gold) {
      budget.gold -= cost
      out.push({ itemId: f, cost })
    } else if ((book[String(f)]?.from ?? []).length > 0) {
      affordableParts(f, book, bag, budget, out)
    }
  }
}

/** Conselho de compra para o item principal conforme o ouro atual. null quando não há receita ou ouro conhecido. */
export function purchaseAdvice(targetId: number | null, book: RecipeBook | undefined, ownedItems: number[], gold: number | undefined): PurchaseAdvice | null {
  if (targetId === null || !book || gold === undefined) return null
  const target = book[String(targetId)]
  if (!target || !target.from || target.from.length === 0) return null
  const bag = new Map<number, number>()
  for (const id of ownedItems) bag.set(id, (bag.get(id) ?? 0) + 1)
  const remaining = remainingCost(targetId, book, new Map(bag))
  const parts = target.from.map((f) => ({ itemId: f, cost: book[String(f)]?.goldTotal ?? 0, owned: (bag.get(f) ?? 0) > 0 }))
  if (remaining <= gold) return { targetId, missing: 0, remaining, mode: 'full', buy: [{ itemId: targetId, cost: remaining }], parts }
  const buy: { itemId: number; cost: number }[] = []
  affordableParts(targetId, book, new Map(bag), { gold }, buy)
  if (buy.length > 0) return { targetId, missing: remaining - gold, remaining, mode: 'parts', buy, parts }
  // nada cabe: junta ouro para a peça restante mais barata
  const pieces: { itemId: number; cost: number }[] = []
  const collect = (id: number, left: Map<number, number>): void => {
    for (const f of book[String(id)]?.from ?? []) {
      const have = left.get(f) ?? 0
      if (have > 0) {
        left.set(f, have - 1)
        continue
      }
      pieces.push({ itemId: f, cost: book[String(f)]?.goldTotal ?? 0 })
      collect(f, left)
    }
  }
  collect(targetId, new Map(bag))
  const next = pieces.filter((p) => p.cost > 0).sort((a, b) => a.cost - b.cost)[0]
  return { targetId, missing: remaining - gold, remaining, mode: 'save', buy: next ? [{ itemId: next.itemId, cost: next.cost }] : [], parts }
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
  /** o que comprar agora para o próximo item principal, conforme o ouro (ausente sem receita ou sem ouro) */
  advice?: PurchaseAdvice | null
  /** estamos na fase dos itens iniciais (ainda não saiu da fonte / primeira compra) */
  starting?: boolean
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
const STARTING_UNTIL_S = 240
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
  /** receitas do Data Dragon, para o conselho de compra por ouro */
  recipes?: RecipeBook
}

/** Monta o estado do painel. A build já vem com as opções escolhidas (a mais usada, ou a que foi enviada ao LoL). */
export function computeOverlay(input: OverlayInput): OverlayState {
  const { build, live } = input
  const owned = new Set(live.items)
  const steps: OverlayItemStep[] = []
  const [c1, c2, c3] = build.items.core
  const boots = build.items.boots[0]
  // Fase inicial: até o primeiro item completo/botas, no começo da partida (poções, Escudo/Lâmina de Doran...).
  const haveMain = [c1, c2, c3, boots].some((id) => id !== undefined && owned.has(id))
  const starting = live.gameTime < STARTING_UNTIL_S && !haveMain && build.items.starting.length > 0
  if (starting) {
    const bag = new Map<number, number>()
    for (const id of live.items) bag.set(id, (bag.get(id) ?? 0) + 1)
    for (const id of build.items.starting) {
      const n = bag.get(id) ?? 0
      if (n > 0) bag.set(id, n - 1)
      steps.push({ itemId: id, label: 'Inicial', owned: n > 0 })
    }
  }
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
  const advice = purchaseAdvice(nextItem?.itemId ?? null, input.recipes, live.items, live.gold)
  return {
    championId: input.championId,
    championName: live.championName,
    role: input.role,
    level: live.level,
    gameTime: live.gameTime,
    gold: live.gold,
    advice,
    ...(starting ? { starting: true } : {}),
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
