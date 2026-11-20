// src/main/data/metaStats.ts
// Estatísticas da tela "Meta": ranking de campeões por rota e detalhe (melhores/piores confrontos, aliados, build).
// Funções puras sobre o dataset.
import type { Role } from '../../shared/types'
import {
  ROLES,
  type MetaChampionDetail,
  type MetaDataset,
  type MetaMatchupRow,
  type MetaTierRow,
  type Tier,
  type WinStats
} from '../../shared/dataTypes'

const PRIOR_GAMES = 100
/** O ranking é mais exigente que o confronto direto: campeão com poucos jogos não sobe sozinho. */
const TIER_PRIOR_GAMES = 300
/** Com menos jogos que isto o tier nunca passa de B (amostra pequena demais para chamar de forte ou fraco). */
const MIN_GAMES_FOR_TIER = 100
/** Confrontos e sinergias com poucos jogos entram na lista, mas puxados para 50% (com menos jogos pesam menos). */
const MIN_MATCHUP_GAMES = 4
const MIN_PAIR_GAMES = 6
const MATCHUP_PRIOR_GAMES = 30
const LIST_SIZE = 5

const smooth = (s: WinStats, prior = PRIOR_GAMES): number => (s.wins + prior / 2) / (s.games + prior)

/** Menos que isto das partidas da rota: campeão de nicho. Fica em B (quem joga muito um campeão raro costuma vencer mais do que ele vale). */
export const RARE_PRESENCE = 0.005
/** S só para quem também é bastante jogado na rota: vitória alta com pouco uso não prova que o campeão é o melhor. */
export const TOP_PRESENCE = 0.015
/** A partir desta taxa de ban o campeão deixa de ser tratado como de nicho no tier. */
export const NICHE_BAN_RATE = 0.05
const TIER_S = 1.5
const TIER_A = 0.6

/**
 * Pontuação do ranking, em pontos acima ou abaixo de 50%.
 * Parte do winrate suavizado e tira a margem de erro (1 erro-padrão): com poucos jogos o número encolhe para 0,
 * então 150 jogos a 58% valem menos que 15 mil jogos a 53%. Vale para cima e para baixo.
 */
export function tierScore(s: WinStats): number {
  const d = smooth(s, TIER_PRIOR_GAMES) - 0.5
  const se = Math.sqrt(0.25 / Math.max(1, s.games))
  return Math.sign(d) * Math.max(0, Math.abs(d) - se) * 100
}

export function tierOf(scorePoints: number): Tier {
  if (scorePoints >= TIER_S) return 'S'
  if (scorePoints >= TIER_A) return 'A'
  if (scorePoints >= -TIER_A) return 'B'
  if (scorePoints >= -TIER_S) return 'C'
  return 'D'
}

export interface Grade {
  /** pontuação conservadora (pontos) */
  score: number
  tier: Tier
  /** poucas partidas ou campeão de nicho: tier limitado a B */
  rare: boolean
}

/** Tier de um campeão numa rota: pontuação conservadora + quanto ele é jogado (presence = fração das partidas da rota). */
export function gradeOf(s: WinStats, presence: number, banRate = 0): Grade {
  const raw = tierScore(s)
  // campeão muito banido não é "de nicho": some do jogo porque o proibem, não porque ninguém o escolhe
  const niche = presence < RARE_PRESENCE && banRate < NICHE_BAN_RATE
  const rare = s.games < MIN_GAMES_FOR_TIER || niche
  let score = raw
  if (rare) score = Math.max(-(TIER_A - 0.01), Math.min(TIER_A - 0.01, raw))
  else if (presence < TOP_PRESENCE) score = Math.min(raw, TIER_S - 0.01)
  return { score, tier: tierOf(score), rare }
}

const totalsCache = new WeakMap<MetaDataset, Map<Role, number>>()
function roleTotal(ds: MetaDataset, role: Role): number {
  let by = totalsCache.get(ds)
  if (!by) {
    by = new Map()
    totalsCache.set(ds, by)
  }
  let total = by.get(role)
  if (total === undefined) {
    total = 0
    for (const c of Object.values(ds.champions)) total += c.roles[role]?.games ?? 0
    by.set(role, total)
  }
  return total
}

/** Fração das partidas da rota em que o campeão aparece. */
export function rolePresence(ds: MetaDataset, championId: number | string, role: Role): number {
  const m = ds.champions[String(championId)]?.roles[role]
  const total = roleTotal(ds, role)
  return m && total > 0 ? m.games / total : 0
}

/** Fração das partidas em que o campeão foi banido; undefined se o meta não traz bans. */
export function banRateOf(ds: MetaDataset, championId: number | string): number | undefined {
  const b = ds.bans
  if (!b || !(b.matches > 0)) return undefined
  return Math.min(1, (b.counts[String(championId)] ?? 0) / b.matches)
}

/** Ranking da rota: melhores primeiro (pelo winrate suavizado, então amostras pequenas não dominam). */
export function tierRows(ds: MetaDataset, role: Role): MetaTierRow[] {
  const total = roleTotal(ds, role)
  const rows: MetaTierRow[] = []
  for (const [id, c] of Object.entries(ds.champions)) {
    const m = c.roles[role]
    if (!m || m.games <= 0) continue
    const delta = (smooth(m, TIER_PRIOR_GAMES) - 0.5) * 100
    const presence = total > 0 ? m.games / total : 0
    // o ban não tem rota: vale para a rota em que o campeão mais joga (a partir de metade das partidas dele)
    let champGames = 0
    for (const r of Object.values(c.roles)) champGames += r?.games ?? 0
    const ban = champGames > 0 && m.games / champGames >= 0.5 ? banRateOf(ds, id) : undefined
    const g = gradeOf(m, presence, ban ?? 0)
    rows.push({
      championId: Number(id),
      games: m.games,
      winrate: m.wins / m.games,
      delta,
      presence,
      ...(ban !== undefined ? { banRate: ban } : {}),
      score: g.score,
      tier: g.tier,
      hasBuild: !!m.build,
      lowSample: m.games < MIN_GAMES_FOR_TIER,
      rare: g.rare
    })
  }
  return rows.sort((a, b) => b.score - a.score || b.games - a.games || a.championId - b.championId)
}

export function championDetail(ds: MetaDataset, championId: number, role: Role): MetaChampionDetail | null {
  const m = ds.champions[String(championId)]?.roles[role]
  if (!m || m.games <= 0) return null
  const total = roleTotal(ds, role)
  const delta = (smooth(m, TIER_PRIOR_GAMES) - 0.5) * 100

  // Confrontos: usa o dado direto e completa com o espelhado (o outro campeão tem a mesma partida).
  const vs = new Map<number, WinStats>()
  for (const [id, s] of Object.entries(m.matchups)) vs.set(Number(id), s)
  for (const [id, c] of Object.entries(ds.champions)) {
    const mirror = c.roles[role]?.matchups[String(championId)]
    if (mirror && !vs.has(Number(id))) vs.set(Number(id), { games: mirror.games, wins: mirror.games - mirror.wins })
  }
  type Row = MetaMatchupRow & { sm: number }
  const rows: Row[] = []
  for (const [id, s] of vs) {
    if (s.games < MIN_MATCHUP_GAMES || id === championId) continue
    rows.push({ championId: id, winrate: s.wins / s.games, games: s.games, sm: smooth(s, MATCHUP_PRIOR_GAMES) })
  }
  rows.sort((a, b) => b.sm - a.sm || b.games - a.games)
  const strip = ({ sm: _sm, ...r }: Row): MetaMatchupRow => r
  let best = rows.filter((r) => r.sm > 0.5).slice(0, LIST_SIZE).map(strip)
  let worst = rows.filter((r) => r.sm < 0.5).slice(-LIST_SIZE).reverse().map(strip)

  // Poucos confrontos diretos na rota (campeão raro ou pouca coleta): completa com o desempenho contra o
  // campeão em qualquer rota ("vs time inimigo"), que tem bem mais partidas. Fica marcado como tal.
  if (best.length < 3 || worst.length < 3) {
    const lane = new Set(rows.map((r) => r.championId))
    const wide: Row[] = []
    for (const [id, s] of Object.entries(m.versus ?? {})) {
      const foe = Number(id)
      if (s.games < MIN_PAIR_GAMES || foe === championId || lane.has(foe)) continue
      wide.push({ championId: foe, winrate: s.wins / s.games, games: s.games, sm: smooth(s, MATCHUP_PRIOR_GAMES), anyLane: true })
    }
    wide.sort((a, b) => b.sm - a.sm || b.games - a.games)
    if (best.length < 3) best = [...best, ...wide.filter((r) => r.sm > 0.5).slice(0, LIST_SIZE - best.length).map(strip)]
    if (worst.length < 3) worst = [...worst, ...wide.filter((r) => r.sm < 0.5).slice(-(LIST_SIZE - worst.length)).reverse().map(strip)]
  }

  const base = smooth(m)
  const allies = Object.entries(m.synergies ?? {})
    .filter(([, s]) => s.games >= MIN_PAIR_GAMES)
    .map(([id, s]) => ({ championId: Number(id), delta: (smooth(s) - base) * 100, games: s.games }))
    .filter((a) => a.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, LIST_SIZE)

  return {
    championId,
    role,
    games: m.games,
    winrate: m.wins / m.games,
    delta,
    presence: total > 0 ? m.games / total : 0,
    tier: gradeOf(m, total > 0 ? m.games / total : 0).tier,
    best,
    worst,
    allies,
    build: m.build ?? null
  }
}

/** Rotas em que o campeão aparece no dataset, da mais jogada para a menos. */
export function rolesOf(ds: MetaDataset, championId: number): Role[] {
  const c = ds.champions[String(championId)]
  if (!c) return []
  return ROLES.filter((r) => (c.roles[r]?.games ?? 0) > 0).sort((a, b) => (c.roles[b]?.games ?? 0) - (c.roles[a]?.games ?? 0))
}
