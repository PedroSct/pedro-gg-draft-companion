// src/main/data/counters.ts
// "Melhor pick do meta contra o inimigo da sua rota", só entre campeões que NÃO estão na sua Pool.
// Função pura sobre o dataset; o botão "adicionar à Pool" fica na interface.
import type { DraftState, Role } from '../../shared/types'
import { ROLES, type FriendProfile, type MetaCounter, type MetaDataset, type WinStats } from '../../shared/dataTypes'

const MIN_GAMES = 30
const PRIOR = 30
/** O campeão precisa ser jogado de verdade na rota (não um pick de brincadeira). */
const MIN_ROLE_SHARE = 0.15
/** Inimigo sem rota informada só vale como "o da minha rota" se ele joga muito nela. */
const MIN_ENEMY_SHARE = 0.5
const MIN_WINRATE = 0.505
const MAX_RESULTS = 3

const smooth = (s: WinStats): number => (s.wins + PRIOR / 2) / (s.games + PRIOR)

function roleShare(ds: MetaDataset, id: number, role: Role): number {
  const roles = ds.champions[String(id)]?.roles
  if (!roles) return 0
  const total = ROLES.reduce((sum, r) => sum + (roles[r]?.games ?? 0), 0)
  return total > 0 ? (roles[role]?.games ?? 0) / total : 0
}

/** Estatística de `id` contra `vs` na rota; usa o espelho se só o oponente tiver dado. */
function versus(ds: MetaDataset, id: number, role: Role, vs: number): WinStats | null {
  const direct = ds.champions[String(id)]?.roles[role]?.matchups[String(vs)]
  if (direct && direct.games > 0) return direct
  const mirror = ds.champions[String(vs)]?.roles[role]?.matchups[String(id)]
  return mirror && mirror.games > 0 ? { games: mirror.games, wins: mirror.games - mirror.wins } : null
}

/** O inimigo que provavelmente enfrentará você na rota (null = ainda não dá para saber). */
export function laneEnemy(draft: DraftState, ds: MetaDataset, role: Role): number | null {
  const known = draft.enemies.filter((e) => e.championId > 0)
  const byRole = known.find((e) => e.role === role)
  if (byRole) return byRole.championId
  let best: { id: number; score: number } | null = null
  for (const e of known) {
    if (e.role && e.role !== role) continue
    const share = roleShare(ds, e.championId, role)
    if (share < MIN_ENEMY_SHARE) continue
    const score = share * (e.status === 'locked' ? 1 : 0.8)
    if (!best || score > best.score) best = { id: e.championId, score }
  }
  return best?.id ?? null
}

export interface CounterInput {
  draft: DraftState
  dataset: MetaDataset | null
  /** perfil de quem está escolhendo (para excluir o que já está na Pool) */
  profile?: FriendProfile
  role: Role | null
}

export function suggestMetaCounters(input: CounterInput): MetaCounter[] {
  const { draft, dataset, role } = input
  if (!dataset || dataset.isSample || !role) return []
  const enemy = laneEnemy(draft, dataset, role)
  if (enemy === null) return []

  const taken = new Set<number>([...draft.bans.allies, ...draft.bans.enemies, ...[...draft.allies, ...draft.enemies].map((p) => p.championId)])
  taken.delete(0)
  const inPool = new Set((input.profile?.pool[role] ?? []).map((e) => e.championId))

  const out: MetaCounter[] = []
  for (const xid of Object.keys(dataset.champions)) {
    const id = Number(xid)
    if (id === enemy || taken.has(id) || inPool.has(id)) continue
    const rm = dataset.champions[xid]?.roles[role]
    if (!rm || roleShare(dataset, id, role) < MIN_ROLE_SHARE) continue
    const vs = versus(dataset, id, role, enemy)
    if (!vs || vs.games < MIN_GAMES) continue
    const wr = smooth(vs)
    if (wr < MIN_WINRATE) continue
    out.push({ championId: id, enemyId: enemy, role, winrate: vs.wins / vs.games, games: vs.games, score: wr })
  }
  return out.sort((a, b) => b.score - a.score || a.championId - b.championId).slice(0, MAX_RESULTS)
}
