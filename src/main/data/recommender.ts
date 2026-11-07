// src/main/data/recommender.ts
// Algoritmo de recomendação: cruza o draft atual com a Champion Pool do amigo.
// Função pura (sem I/O): fácil de testar e de ajustar pesos.
//
// score = matchup·w1 + baseline·w2 + conforto·w3 + sinergia·w4   (tudo em "pontos percentuais")
//  - matchup : (winrate suavizado vs. oponente provável da rota − 50%) × 100
//  - baseline: (winrate suavizado do campeão na rota − 50%) × 100
//  - conforto: (nível 1..5 − 3) por nível
//  - sinergia: quanto o winrate do campeão muda quando os aliados já escolhidos estão no time
//  - versus  : desempenho médio contra os outros campeões do time inimigo (qualquer rota)
//  - comp    : encaixe na composição: equilíbrio de dano físico/mágico, frontline e controle de grupo
// Além do score, cada pick traz um "risco" (como no Draftforge): counters que o inimigo ainda pode escolher.
// Winrates passam por suavização bayesiana (puxa para 50% quando há poucos jogos).
import { guessRole } from '../../shared/roleGuess'
import type { DraftState, Role } from '../../shared/types'
import { traitsOf, type Traits } from '../../shared/traits'
import {
  ROLES,
  type ChampionInfo,
  type CompReason,
  type Confidence,
  type ExclusionReason,
  type FriendProfile,
  type MatchupFactor,
  type MetaDataset,
  type PickRisk,
  type PickScore,
  type RecommendMode,
  type Recommendation,
  type SynergyFactor,
  type WinStats
} from '../../shared/dataTypes'

export interface RecommendWeights {
  matchup: number
  baseline: number
  /** pontos por nível de conforto acima/abaixo de 3 */
  comfort: number
  synergy: number
  /** contra o time inimigo inteiro */
  versus: number
  /** encaixe na composição */
  comp: number
}

export const DEFAULT_WEIGHTS: RecommendWeights = { matchup: 1, baseline: 0.5, comfort: 0.75, synergy: 0.6, versus: 0.5, comp: 1 }

/** "Equilibrado" é o padrão; "Conforto" privilegia o que você domina; "Meta" privilegia os números. */
export const MODE_WEIGHTS: Record<RecommendMode, RecommendWeights> = {
  balanced: DEFAULT_WEIGHTS,
  comfort: { matchup: 0.5, baseline: 0.25, comfort: 2, synergy: 0.3, versus: 0.25, comp: 0.5 },
  meta: { matchup: 1.2, baseline: 1, comfort: 0.1, synergy: 0.8, versus: 0.8, comp: 1 }
}

/** "Jogos fictícios" a 50% — quanto maior, mais conservador com amostras pequenas. */
const PRIOR_GAMES = 100
/** Inimigo só conta como oponente de rota se jogar nela em pelo menos 20% das partidas. */
const MIN_LANE_SHARE = 0.2
const HIGH_COVERAGE = 0.6
/** Inimigo confirmado com mais desta fatia das partidas na rota = oponente de rota (a LCU não informa a rota deles). */
const LANE_OPPONENT_SHARE = 0.7
/** Counter = o oponente vence o seu campeão com winrate (suavizado) igual ou acima de 53%. */
const COUNTER_WR = 0.47
const HIGH_RISK_WR = 0.45

export interface RecommendInput {
  draft: DraftState
  profile: FriendProfile
  dataset: MetaDataset | null
  /** Rota a considerar. Padrão: rota atribuída ao jogador local. Sem rota: usa a Pool inteira. */
  role?: Role | null
  /** Em blind pick o inimigo pode repetir seu campeão. Padrão: false (draft). */
  allowMirror?: boolean
  /** Preset de pesos (padrão: balanced). `weights` ajusta por cima. */
  mode?: RecommendMode
  weights?: Partial<RecommendWeights>
  /** Data Dragon: estima dano/tanque quando o meta não tem o perfil do campeão. */
  champions?: readonly ChampionInfo[]
}

const shrink = (s: WinStats): number => (s.wins + PRIOR_GAMES / 2) / (s.games + PRIOR_GAMES)

function roleShare(dataset: MetaDataset, championId: number, role: Role): number | null {
  const roles = dataset.champions[String(championId)]?.roles
  if (!roles) return null
  const total = ROLES.reduce((sum, r) => sum + (roles[r]?.games ?? 0), 0)
  if (total <= 0) return null
  return (roles[role]?.games ?? 0) / total
}

/** Estatística do campeão contra `vs` na mesma rota; usa o dado espelhado se só o oponente tiver. */
function matchupStats(dataset: MetaDataset, championId: number, role: Role, vs: number): WinStats | null {
  const direct = dataset.champions[String(championId)]?.roles[role]?.matchups[String(vs)]
  if (direct && direct.games > 0) return direct
  const mirrored = dataset.champions[String(vs)]?.roles[role]?.matchups[String(championId)]
  if (mirrored && mirrored.games > 0) return { games: mirrored.games, wins: mirrored.games - mirrored.wins }
  return null
}

/** Quem provavelmente enfrentará o jogador na rota (inimigos não revelam rota na Champ Select). */
/** O oponente de rota quando dá para ter quase certeza (travado e de rota conhecida); null nos demais casos. */
export function laneEnemyOf(draft: DraftState, dataset: MetaDataset, role: Role): number | null {
  const list = laneOpponents(draft, dataset, role).sort((a, b) => b.weight - a.weight)
  const [top, second] = list
  if (!top || top.weight < 0.6) return null
  if (second && second.weight > top.weight - 0.2) return null
  return top.championId
}

function laneOpponents(
  draft: DraftState,
  dataset: MetaDataset,
  role: Role
): { championId: number; weight: number }[] {
  const out: { championId: number; weight: number }[] = []
  for (const e of draft.enemies) {
    if (e.championId <= 0) continue
    const statusWeight = e.status === 'locked' ? 1 : 0.5 // hover ainda pode mudar
    const share = e.role ? (e.role === role ? 1 : 0) : (roleShare(dataset, e.championId, role) ?? 0)
    if (share < MIN_LANE_SHARE) continue
    out.push({ championId: e.championId, weight: statusWeight * share })
  }
  return out
}

/** "Jogos fictícios" da sinergia (em torno do winrate do próprio campeão), como no desempenho contra inimigos. */
const SYNERGY_PRIOR = 40

/** Média ponderada de quanto cada aliado já escolhido ajuda (ou atrapalha) o campeão. */
function synergyOf(
  dataset: MetaDataset,
  draft: DraftState,
  championId: number,
  role: Role,
  baseline: number
): { delta: number | null; list: SynergyFactor[] } {
  const table = dataset.champions[String(championId)]?.roles[role]?.synergies
  if (!table) return { delta: null, list: [] }
  const list: SynergyFactor[] = []
  let weighted = 0
  let weights = 0
  for (const a of draft.allies) {
    if (a.cellId === draft.localPlayerCellId || a.championId <= 0 || a.championId === championId) continue
    const stats = table[String(a.championId)]
    if (!stats || stats.games <= 0) continue
    const w = a.status === 'locked' ? 1 : 0.5
    // Suaviza em direção ao winrate do próprio campeão (e não a 50%): senão um campeão forte com poucas partidas ao
    // lado de um aliado pareceria "piorar" com ele só porque 50% < seu winrate normal.
    const delta = ((stats.wins + SYNERGY_PRIOR * baseline) / (stats.games + SYNERGY_PRIOR) - baseline) * 100
    weighted += w * delta
    weights += w
    list.push({ withChampionId: a.championId, delta, games: stats.games })
  }
  list.sort((x, y) => y.delta - x.delta)
  return { delta: weights > 0 ? weighted / weights : null, list }
}

/** Counters que o inimigo ainda pode escolher para a sua rota. */
function riskOf(
  dataset: MetaDataset,
  draft: DraftState,
  unavailable: Map<number, ExclusionReason>,
  championId: number,
  role: Role
): PickRisk {
  const none: PickRisk = { level: 'none', counters: [] }
  // Já sabemos quem é o oponente de rota (rota informada e pick confirmado)? Aí não há o que temer em aberto.
  if (draft.enemies.some((e) => e.role === role && e.status === 'locked' && e.championId > 0)) return none
  // A LCU não revela a rota do time inimigo. Se um inimigo já confirmado joga quase sempre nesta rota
  // (mais de 70% das partidas), ele é o oponente de rota na prática e o alerta de "counter ainda disponível" é falso.
  if (draft.enemies.some((e) => e.status === 'locked' && e.championId > 0 && (roleShare(dataset, e.championId, role) ?? 0) > LANE_OPPONENT_SHARE)) return none
  const openSlots = draft.enemies.some((e) => e.status !== 'locked') || draft.enemies.length < 5
  if (!openSlots) return none

  const taken = new Set<number>(draft.enemies.filter((e) => e.championId > 0).map((e) => e.championId))
  const found = new Map<number, MatchupFactor>()
  const consider = (vs: number): void => {
    if (vs === championId || unavailable.has(vs) || taken.has(vs) || found.has(vs)) return
    if ((roleShare(dataset, vs, role) ?? 0) < MIN_LANE_SHARE) return
    const stats = matchupStats(dataset, championId, role, vs)
    if (!stats) return
    const wr = shrink(stats)
    if (wr <= COUNTER_WR) found.set(vs, { vsChampionId: vs, winrate: wr, games: stats.games })
  }
  for (const vs of Object.keys(dataset.champions[String(championId)]?.roles[role]?.matchups ?? {})) consider(Number(vs))
  for (const [id, c] of Object.entries(dataset.champions)) if (c.roles[role]?.matchups[String(championId)]) consider(Number(id))

  const counters = [...found.values()].sort((a, b) => a.winrate - b.winrate).slice(0, 3)
  const worst = counters[0]?.winrate ?? 1
  const level = counters.length === 0 ? 'none' : worst <= HIGH_RISK_WR || counters.length >= 3 ? 'high' : counters.length === 2 ? 'medium' : 'low'
  return { level, counters }
}

/** "Jogos fictícios" do desempenho contra um campeão (em torno do winrate do próprio campeão). */
const VERSUS_PRIOR = 40

/** Média ponderada do desempenho contra os inimigos que ainda não entraram como oponente de rota. */
function versusOf(
  dataset: MetaDataset,
  draft: DraftState,
  championId: number,
  role: Role,
  baseline: number,
  skip: Set<number>
): { delta: number | null; list: SynergyFactor[] } {
  const table = dataset.champions[String(championId)]?.roles[role]?.versus
  if (!table) return { delta: null, list: [] }
  const list: SynergyFactor[] = []
  let weighted = 0
  let weights = 0
  for (const e of draft.enemies) {
    if (e.championId <= 0 || e.championId === championId || skip.has(e.championId)) continue
    const stats = table[String(e.championId)]
    if (!stats || stats.games <= 0) continue
    const w = e.status === 'locked' ? 1 : 0.5
    const delta = ((stats.wins + VERSUS_PRIOR * baseline) / (stats.games + VERSUS_PRIOR) - baseline) * 100
    weighted += w * delta
    weights += w
    list.push({ withChampionId: e.championId, delta, games: stats.games })
  }
  list.sort((x, y) => y.delta - x.delta)
  return { delta: weights > 0 ? weighted / weights : null, list }
}

// ------------------------------------------------------------------ composição

/** Quanto cada rota costuma contribuir com dano ao time. */
const DAMAGE_WEIGHT: Record<Role, number> = { TOP: 0.8, JUNGLE: 0.7, MIDDLE: 1, BOTTOM: 1.1, UTILITY: 0.35 }
/** Só olha a composição com pelo menos isto de aliados já conhecidos. */
const MIN_ALLIES_FOR_COMP = 2
/** Pontos por unidade de desequilíbrio de dano resolvido/criado (0..1). */
const DAMAGE_BALANCE_POINTS = 25
const FRONTLINE_POINTS = 8
const CC_POINTS = 1.5

interface CompFit {
  points: number
  reasons: CompReason[]
}

const imbalance = (magicShare: number): number => Math.max(0, Math.abs(magicShare - 0.5) - 0.2)

/** O que o candidato muda no time: equilíbrio AP/AD, frontline e CC. */
function compFitOf(
  draft: DraftState,
  candidate: Traits,
  candidateRole: Role,
  traitFor: (championId: number, role: Role | null) => Traits
): CompFit {
  const allies = draft.allies.filter((a) => a.cellId !== draft.localPlayerCellId && a.championId > 0)
  if (allies.length < MIN_ALLIES_FOR_COMP) return { points: 0, reasons: [] }

  let phys = 0
  let magic = 0
  let front = 0
  let cc = 0
  for (const a of allies) {
    const t = traitFor(a.championId, a.role)
    const presence = a.status === 'locked' ? 1 : 0.5
    const dmg = (a.role ? DAMAGE_WEIGHT[a.role] : 0.8) * presence
    phys += dmg * (t.physical + t.true * 0.5)
    magic += dmg * (t.magic + t.true * 0.5)
    front += presence * t.durability
    cc += presence * t.cc
  }
  const before = phys + magic > 0 ? magic / (phys + magic) : 0.5
  const own = DAMAGE_WEIGHT[candidateRole]
  const phys1 = phys + own * (candidate.physical + candidate.true * 0.5)
  const magic1 = magic + own * (candidate.magic + candidate.true * 0.5)
  const after = phys1 + magic1 > 0 ? magic1 / (phys1 + magic1) : 0.5

  const reasons: CompReason[] = []
  let points = (imbalance(before) - imbalance(after)) * DAMAGE_BALANCE_POINTS
  if (imbalance(before) - imbalance(after) > 0.02) reasons.push(before < 0.5 ? 'adds-magic' : 'adds-physical')
  else if (imbalance(after) - imbalance(before) > 0.02 && imbalance(after) > 0) reasons.push(after < 0.5 ? 'too-much-physical' : 'too-much-magic')

  // Frontline: o time precisa de pelo menos ~1,2 "unidades" de tanque (um tanque + um semi-tanque)
  const need = Math.min(1, Math.max(-0.5, (1.2 - front) / 1.2))
  const frontPoints = need * (candidate.durability - 0.45) * FRONTLINE_POINTS
  points += frontPoints
  if (frontPoints > 1) reasons.push('adds-frontline')
  else if (frontPoints < -1 && candidate.durability > 0.6) reasons.push('frontline-surplus')

  // CC: time sem controle de grupo (menos de ~0,8 unidades) ganha com quem tem
  const ccNeed = Math.min(1, Math.max(0, (0.8 - cc) / 0.8))
  const ccPoints = ccNeed * (candidate.cc - 0.4) * CC_POINTS * 2
  points += ccPoints
  if (ccPoints > 0.5) reasons.push('adds-cc')

  return { points, reasons }
}

function unavailableChampions(draft: DraftState, allowMirror: boolean): Map<number, ExclusionReason> {
  const m = new Map<number, ExclusionReason>()
  for (const id of [...draft.bans.allies, ...draft.bans.enemies]) m.set(id, 'banned')
  for (const p of draft.allies) {
    // O pick do próprio jogador não o exclui; hover de aliado também não (pode repetir).
    if (p.status === 'locked' && p.cellId !== draft.localPlayerCellId && p.championId > 0 && !m.has(p.championId)) {
      m.set(p.championId, 'picked-ally')
    }
  }
  if (!allowMirror) {
    for (const p of draft.enemies) {
      if (p.status === 'locked' && p.championId > 0 && !m.has(p.championId)) m.set(p.championId, 'picked-enemy')
    }
  }
  return m
}

export function recommend(input: RecommendInput): Recommendation {
  const { draft, profile, dataset } = input
  const w = { ...MODE_WEIGHTS[input.mode ?? 'balanced'], ...input.weights }
  const given = input.role ?? draft.localRole
  const guessed = given ? null : guessRole(draft, profile)
  const role = given ?? guessed
  const unavailable = unavailableChampions(draft, input.allowMirror ?? false)

  const entries = (role ? [role] : [...ROLES]).flatMap((r) => profile.pool[r].map((entry) => ({ entry, role: r })))

  const excludedMap = new Map<number, ExclusionReason>()
  const candidates: typeof entries = []
  for (const c of entries) {
    const reason = unavailable.get(c.entry.championId)
    if (reason) excludedMap.set(c.entry.championId, reason)
    else candidates.push(c)
  }
  const champMap = input.champions ? new Map(input.champions.map((c) => [c.id, c])) : null
  const traitCache = new Map<string, Traits>()
  const traitFor = (championId: number, r: Role | null): Traits => {
    const k = `${championId}|${r ?? ''}`
    let t = traitCache.get(k)
    if (!t) {
      t = traitsOf(dataset, champMap, championId, r)
      traitCache.set(k, t)
    }
    return t
  }
  const excluded = [...excludedMap].map(([championId, reason]) => ({ championId, reason }))

  const ranking: PickScore[] = candidates.map(({ entry, role: r }) => {
    const id = entry.championId
    const base = dataset?.champions[String(id)]?.roles[r]
    const baselineWinrate = base && base.games > 0 ? shrink(base) : null

    let matchupWinrate: number | null = null
    let matchupCoverage = 0
    const matchups: MatchupFactor[] = []
    if (dataset) {
      const opponents = laneOpponents(draft, dataset, r)
      const totalWeight = opponents.reduce((s, o) => s + o.weight, 0)
      let usedWeight = 0
      let weighted = 0
      for (const o of opponents) {
        const stats = matchupStats(dataset, id, r, o.championId)
        if (!stats) continue
        const wr = shrink(stats)
        usedWeight += o.weight
        weighted += o.weight * wr
        matchups.push({ vsChampionId: o.championId, winrate: wr, games: stats.games })
      }
      if (usedWeight > 0) {
        matchupWinrate = weighted / usedWeight
        matchupCoverage = usedWeight / totalWeight
      }
    }

    const syn = dataset ? synergyOf(dataset, draft, id, r, baselineWinrate ?? 0.5) : { delta: null, list: [] }
    const risk = dataset ? riskOf(dataset, draft, unavailable, id, r) : { level: 'none' as const, counters: [] }

    // Contra o resto do time inimigo: quem já entrou como oponente de rota não conta duas vezes.
    const laneFoes = new Set(matchups.map((m) => m.vsChampionId))
    const vs = dataset ? versusOf(dataset, draft, id, r, baselineWinrate ?? 0.5, laneFoes) : { delta: null, list: [] }
    const comp = compFitOf(draft, traitFor(id, r), r, traitFor)

    const factors = {
      matchup: matchupWinrate === null ? 0 : (matchupWinrate - 0.5) * 100 * w.matchup,
      baseline: baselineWinrate === null ? 0 : (baselineWinrate - 0.5) * 100 * w.baseline,
      comfort: (Math.min(5, Math.max(1, entry.comfort)) - 3) * w.comfort,
      synergy: syn.delta === null ? 0 : syn.delta * w.synergy,
      versus: vs.delta === null ? 0 : vs.delta * w.versus,
      comp: comp.points * w.comp
    }

    const confidence: Confidence =
      matchupWinrate !== null ? (matchupCoverage >= HIGH_COVERAGE ? 'high' : 'medium') : 'low'

    return {
      championId: id,
      championKey: entry.championKey,
      role: r,
      score: factors.matchup + factors.baseline + factors.comfort + factors.synergy + factors.versus + factors.comp,
      comfort: entry.comfort,
      confidence,
      baselineWinrate,
      ...(base && base.games > 0 ? { baselineGames: base.games } : {}),
      matchupWinrate,
      matchupCoverage,
      matchups,
      synergyDelta: syn.delta,
      synergies: syn.list,
      risk,
      factors,
      versusDelta: vs.delta,
      versusList: vs.list,
      compReasons: comp.reasons
    }
  })

  ranking.sort((a, b) => b.score - a.score || b.comfort - a.comfort || a.championId - b.championId)

  let note: Recommendation['note']
  if (!entries.length) note = 'empty-pool'
  else if (!candidates.length) note = 'all-unavailable'
  else if (!dataset) note = 'no-meta-data'

  return { role: role ?? null, ...(guessed ? { roleGuessed: true } : {}), confidence: ranking[0]?.confidence ?? 'none', ranking, excluded, note }
}
