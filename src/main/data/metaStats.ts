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
const MIN_MATCHUP_GAMES = 8
const LIST_SIZE = 5

const smooth = (s: WinStats, prior = PRIOR_GAMES): number => (s.wins + prior / 2) / (s.games + prior)

function tierFor(delta: number, games: number): Tier {
  const t = tierOf(delta)
  return games < MIN_GAMES_FOR_TIER && (t === 'S' || t === 'A') ? 'B' : t
}

export function tierOf(deltaPoints: number): Tier {
  if (deltaPoints >= 2) return 'S'
  if (deltaPoints >= 0.8) return 'A'
  if (deltaPoints >= -0.8) return 'B'
  if (deltaPoints >= -2) return 'C'
  return 'D'
}

function roleTotal(ds: MetaDataset, role: Role): number {
  let total = 0
  for (const c of Object.values(ds.champions)) total += c.roles[role]?.games ?? 0
  return total
}

/** Ranking da rota: melhores primeiro (pelo winrate suavizado, então amostras pequenas não dominam). */
export function tierRows(ds: MetaDataset, role: Role): MetaTierRow[] {
  const total = roleTotal(ds, role)
  const rows: MetaTierRow[] = []
  for (const [id, c] of Object.entries(ds.champions)) {
    const m = c.roles[role]
    if (!m || m.games <= 0) continue
    const delta = (smooth(m, TIER_PRIOR_GAMES) - 0.5) * 100
    rows.push({
      championId: Number(id),
      games: m.games,
      winrate: m.wins / m.games,
      delta,
      presence: total > 0 ? m.games / total : 0,
      tier: tierFor(delta, m.games),
      hasBuild: !!m.build
    })
  }
  return rows.sort((a, b) => b.delta - a.delta || b.games - a.games || a.championId - b.championId)
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
  const rows: (MetaMatchupRow & { sm: number })[] = []
  for (const [id, s] of vs) {
    if (s.games < MIN_MATCHUP_GAMES || id === championId) continue
    rows.push({ championId: id, winrate: s.wins / s.games, games: s.games, sm: smooth(s) })
  }
  rows.sort((a, b) => b.sm - a.sm || b.games - a.games)
  const strip = ({ sm: _sm, ...r }: MetaMatchupRow & { sm: number }): MetaMatchupRow => r
  const best = rows.filter((r) => r.sm > 0.5).slice(0, LIST_SIZE).map(strip)
  const worst = rows.filter((r) => r.sm < 0.5).slice(-LIST_SIZE).reverse().map(strip)

  const base = smooth(m)
  const allies = Object.entries(m.synergies ?? {})
    .filter(([, s]) => s.games >= MIN_MATCHUP_GAMES)
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
    tier: tierFor(delta, m.games),
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
