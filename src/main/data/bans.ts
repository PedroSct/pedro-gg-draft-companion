// src/main/data/bans.ts
// Sugestões de banimento: quem mais atrapalha os campeões que você e seus amigos (com perfil) mais
// confiam, e quem está forte no meta. Função pura sobre o dataset, sem I/O.
import type { DraftState, Role } from '../../shared/types'
import { ROLES, type BanReason, type BanSuggestion, type FriendProfile, type MetaDataset, type WinStats } from '../../shared/dataTypes'
import { tierOf } from './metaStats'

/** Só campeões com conforto 4 ou 5 pesam: não vale gastar ban para proteger um pick inseguro. */
const MIN_COMFORT = 4
/** Confronto com menos jogos que isto não vira motivo de ban (é ruído). */
const MIN_MATCHUP_GAMES = 5
const MATCHUP_PRIOR = 30
const META_PRIOR = 300
const META_WEIGHT = 0.5
/** Campeão que quase ninguém joga na rota não conta como ameaça na rota. */
const MIN_ROLE_SHARE = 0.15
/** Pontuação mínima para entrar na lista. */
const MIN_SCORE = 0.6
const MAX_SUGGESTIONS = 5

const smooth = (s: WinStats, prior: number): number => (s.wins + prior / 2) / (s.games + prior)

export interface BanInput {
  draft: DraftState
  dataset: MetaDataset | null
  /** todos os perfis salvos; os aliados reconhecidos (profileId) é que entram na conta */
  profiles: readonly FriendProfile[]
  /** perfil usado para o seu lugar caso o app não tenha reconhecido você pelo Riot ID */
  fallbackProfileId?: string
}

/** O draft já passou da fase de banimentos? (com picks travados não faz mais sentido sugerir ban) */
export function banPhaseOpen(draft: DraftState): boolean {
  if (draft.phase === 'PLANNING') return true
  if (draft.phase !== 'BAN_PICK') return false
  const bans = draft.bans.allies.length + draft.bans.enemies.length
  const locked = [...draft.allies, ...draft.enemies].some((p) => p.status === 'locked')
  return bans < 10 && !locked
}

export function suggestBans(input: BanInput): BanSuggestion[] {
  const { draft, dataset } = input
  if (!dataset || dataset.isSample) return []
  const taken = new Set<number>([...draft.bans.allies, ...draft.bans.enemies, ...[...draft.allies, ...draft.enemies].map((p) => p.championId)])
  taken.delete(0)
  const profileById = new Map(input.profiles.map((p) => [p.id, p]))

  // Quem protegemos: campeão de conforto alto de cada aliado com perfil, na rota dele.
  interface Guard {
    championId: number
    role: Role
    weight: number
    nickname: string
  }
  const guards: Guard[] = []
  for (const a of draft.allies) {
    const id = a.profileId ?? (a.cellId === draft.localPlayerCellId ? input.fallbackProfileId : undefined)
    const profile = id ? profileById.get(id) : undefined
    if (!profile) continue
    const role = a.role ?? (a.cellId === draft.localPlayerCellId ? draft.localRole : null)
    if (!role || !ROLES.includes(role)) continue
    for (const e of profile.pool[role] ?? []) {
      if (e.comfort < MIN_COMFORT) continue
      guards.push({ championId: e.championId, role, weight: (e.comfort - 3) / 2, nickname: profile.nickname })
    }
  }

  const scores = new Map<number, { score: number; reasons: BanReason[] }>()
  const bump = (id: number, delta: number, reason: BanReason): void => {
    const cur = scores.get(id) ?? { score: 0, reasons: [] }
    cur.score += delta
    cur.reasons.push(reason)
    scores.set(id, cur)
  }

  // Quanto o campeão joga em cada rota (para não culpar um suporte por ser forte contra seu top).
  const share = (id: string, role: Role): number => {
    const roles = dataset.champions[id]?.roles
    if (!roles) return 0
    let total = 0
    for (const r of ROLES) total += roles[r]?.games ?? 0
    return total > 0 ? (roles[role]?.games ?? 0) / total : 0
  }

  for (const g of guards) {
    for (const [xid, x] of Object.entries(dataset.champions)) {
      const idNum = Number(xid)
      if (taken.has(idNum)) continue
      const rm = x.roles[g.role]
      const vs = rm?.matchups[String(g.championId)]
      if (!rm || !vs || vs.games < MIN_MATCHUP_GAMES) continue
      const s = share(xid, g.role)
      if (s < MIN_ROLE_SHARE) continue
      const gap = smooth(vs, MATCHUP_PRIOR) - 0.5
      if (gap <= 0.015) continue
      bump(idNum, gap * 100 * g.weight * s, {
        kind: 'counter',
        championId: g.championId,
        nickname: g.nickname,
        role: g.role,
        winrate: vs.wins / vs.games,
        games: vs.games
      })
    }
  }

  // Força no meta: o mais forte de cada rota também merece ban, mesmo sem ligação com o seu pool.
  for (const [xid, x] of Object.entries(dataset.champions)) {
    const idNum = Number(xid)
    if (taken.has(idNum)) continue
    for (const role of ROLES) {
      const m = x.roles[role]
      if (!m || m.games < 100) continue
      const s = share(xid, role)
      if (s < MIN_ROLE_SHARE) continue
      const delta = (smooth(m, META_PRIOR) - 0.5) * 100
      const tier = tierOf(delta)
      if (tier !== 'S' && tier !== 'A') continue
      bump(idNum, delta * s * META_WEIGHT, { kind: 'meta', role, tier, winrate: m.wins / m.games, games: m.games })
    }
  }

  return [...scores.entries()]
    .filter(([, v]) => v.score >= MIN_SCORE)
    .map(([championId, v]) => ({
      championId,
      score: Math.round(v.score * 100) / 100,
      // motivos mais fortes primeiro: counters ao seu pool, depois o meta; no máximo 3
      reasons: v.reasons
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'counter' ? -1 : 1) || (b.winrate - a.winrate))
        .slice(0, 3)
    }))
    .sort((a, b) => b.score - a.score || a.championId - b.championId)
    .slice(0, MAX_SUGGESTIONS)
}
