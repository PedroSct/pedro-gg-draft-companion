// src/main/data/synergies.ts
// Combos entre duas rotas (ADC+suporte, meio+selva, topo+meio...) para a tela Meta e para o modo Grupo do Draft.
// Funções puras sobre o dataset.
import type { Role } from '../../shared/types'
import { ROLES, type MetaDataset, type MetaSynergyRow, type Tier, type WinStats } from '../../shared/dataTypes'
import { tierOf, tierScore } from './metaStats'

/** Pares com menos jogos que isto não entram na lista (o número seria só sorte). */
export const MIN_SYNERGY_GAMES = 30
/** Com menos jogos que isto o combo é marcado como amostra pequena e o tier não passa de B. */
export const SOLID_SYNERGY_GAMES = 100
/** O parceiro precisa jogar a rota pedida em pelo menos essa fração das suas partidas (o dado guarda o aliado sem a rota dele). */
export const PARTNER_ROLE_SHARE = 0.5
const PAIR_PRIOR = 100
const TIER_CAP = 0.59

const smooth = (s: WinStats, prior = PAIR_PRIOR): number => (s.wins + prior / 2) / (s.games + prior)

const shareCache = new WeakMap<MetaDataset, Map<string, { role: Role; share: number } | null>>()
/** Rota principal de um campeão e a fração das partidas dele nessa rota. */
export function mainRole(ds: MetaDataset, championId: number | string): { role: Role; share: number } | null {
  let by = shareCache.get(ds)
  if (!by) {
    by = new Map()
    shareCache.set(ds, by)
  }
  const key = String(championId)
  const hit = by.get(key)
  if (hit !== undefined) return hit
  const c = ds.champions[key]
  let best: Role | null = null
  let bestGames = 0
  let sum = 0
  if (c) {
    for (const r of ROLES) {
      const g = c.roles[r]?.games ?? 0
      sum += g
      if (g > bestGames) {
        best = r
        bestGames = g
      }
    }
  }
  const out = best && sum > 0 ? { role: best, share: bestGames / sum } : null
  by.set(key, out)
  return out
}

/** Parte das partidas do campeão que foram numa rota (0..1). */
export function roleShare(ds: MetaDataset, championId: number | string, role: Role): number {
  const c = ds.champions[String(championId)]
  if (!c) return 0
  let sum = 0
  for (const r of ROLES) sum += c.roles[r]?.games ?? 0
  return sum > 0 ? (c.roles[role]?.games ?? 0) / sum : 0
}

export function rowOf(ds: MetaDataset, anchorId: number, anchorRole: Role, mateId: number, mateRole: Role, s: WinStats, anchorIsA: boolean): MetaSynergyRow | null {
  const anchor = ds.champions[String(anchorId)]?.roles[anchorRole]
  const mate = ds.champions[String(mateId)]?.roles[mateRole]
  if (!anchor || !mate || anchor.games <= 0 || mate.games <= 0) return null
  const sm = smooth(s)
  // sinergia = o que a dupla rende além da soma dos dois sozinhos (cada um menos 50%)
  const expected = smooth(anchor, 300) + smooth(mate, 300) - 0.5
  const synergy = (sm - expected) * 100
  const rare = s.games < SOLID_SYNERGY_GAMES
  let score = tierScore(s)
  if (rare) score = Math.max(-TIER_CAP, Math.min(TIER_CAP, score))
  const tier: Tier = tierOf(score)
  return {
    aId: anchorIsA ? anchorId : mateId,
    bId: anchorIsA ? mateId : anchorId,
    games: s.games,
    winrate: s.wins / s.games,
    synergy,
    score,
    tier,
    rare
  }
}

/** Parceiros de um campeão (na rota dele) que jogam `mateRole`, com os números da dupla. Usa a tabela de sinergia exata do campeão. */
export function partnersOf(ds: MetaDataset, championId: number, role: Role, mateRole: Role, anchorIsA: boolean, minGames = MIN_SYNERGY_GAMES): MetaSynergyRow[] {
  const meta = ds.champions[String(championId)]?.roles[role]
  if (!meta || role === mateRole) return []
  const out: MetaSynergyRow[] = []
  // meta novo: a dupla já vem com as duas rotas, sem precisar adivinhar a rota do parceiro
  if (meta.pairs) {
    const prefix = `${mateRole}:`
    for (const [key, s] of Object.entries(meta.pairs)) {
      if (!key.startsWith(prefix) || s.games < minGames) continue
      const mateId = Number(key.slice(prefix.length))
      if (!Number.isFinite(mateId) || mateId === championId) continue
      const row = rowOf(ds, championId, role, mateId, mateRole, s, anchorIsA)
      if (row) out.push(row)
    }
    return out
  }
  const table = meta.synergies
  if (!table) return []
  for (const [id, s] of Object.entries(table)) {
    if (s.games < minGames) continue
    const mateId = Number(id)
    if (!Number.isFinite(mateId) || mateId === championId) continue
    if (roleShare(ds, mateId, mateRole) < PARTNER_ROLE_SHARE) continue
    const row = rowOf(ds, championId, role, mateId, mateRole, s, anchorIsA)
    if (row) out.push(row)
  }
  return out
}

const byScore = (a: MetaSynergyRow, b: MetaSynergyRow): number => b.score - a.score || b.games - a.games

/**
 * Melhores combos entre as rotas A e B. Com `anchor` (campeão numa das duas rotas) lista só os parceiros dele.
 * `limit` corta a lista; melhores primeiro (nota conservadora: poucos jogos encolhem para perto de zero).
 */
export function synergyPairs(ds: MetaDataset, roleA: Role, roleB: Role, opts: { anchor?: number; anchorRole?: Role; limit?: number } = {}): MetaSynergyRow[] {
  if (roleA === roleB || !ROLES.includes(roleA) || !ROLES.includes(roleB)) return []
  const limit = opts.limit ?? 60
  let rows: MetaSynergyRow[] = []
  if (opts.anchor != null) {
    const side = opts.anchorRole === roleB ? 'B' : 'A'
    rows = side === 'A' ? partnersOf(ds, opts.anchor, roleA, roleB, true) : partnersOf(ds, opts.anchor, roleB, roleA, false)
  } else {
    for (const id of Object.keys(ds.champions)) rows.push(...partnersOf(ds, Number(id), roleA, roleB, true))
  }
  return rows.sort(byScore).slice(0, limit)
}

/**
 * Números de uma dupla já formada (as duas rotas são conhecidas pelo draft). Usa a tabela de sinergia dos dois lados e, havendo as duas,
 * a de menos jogos (a que mais se aproxima só das partidas em que cada um estava na rota certa). null sem amostra.
 */
export function pairRow(ds: MetaDataset, aId: number, aRole: Role, bId: number, bRole: Role, minGames = 10): MetaSynergyRow | null {
  const exactA = ds.champions[String(aId)]?.roles[aRole]?.pairs?.[`${bRole}:${bId}`]
  const exactB = ds.champions[String(bId)]?.roles[bRole]?.pairs?.[`${aRole}:${aId}`]
  const exact = [exactA, exactB].filter((x): x is WinStats => !!x && x.games >= minGames)
  if (exact.length > 0) return rowOf(ds, aId, aRole, bId, bRole, exact.reduce((m, x) => (x.games < m.games ? x : m)), true)
  const sA = ds.champions[String(aId)]?.roles[aRole]?.synergies?.[String(bId)]
  const sB = ds.champions[String(bId)]?.roles[bRole]?.synergies?.[String(aId)]
  const ok = [sA, sB].filter((x): x is WinStats => !!x && x.games >= minGames)
  if (ok.length === 0) return null
  const s = ok.reduce((m, x) => (x.games < m.games ? x : m))
  return rowOf(ds, aId, aRole, bId, bRole, s, true)
}
