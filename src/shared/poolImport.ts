// src/shared/poolImport.ts
// Sugere a Pool a partir da conta logada no cliente: partidas recentes (rota, vitória) e pontos de maestria.
// Regras puras e testáveis; a leitura do cliente fica em src/main/lcu/accountPool.ts.
import { ROLES, type Pool, type PoolEntry } from './dataTypes'
import type { Role } from './types'

/** Uma partida recente da conta (já filtrada para filas normais e ranqueadas). */
export interface AccountGame {
  championId: number
  role: Role | null
  win: boolean
}

export interface MasteryEntry {
  championId: number
  points: number
  level: number
}

export interface PoolCandidate {
  championId: number
  role: Role
  games: number
  wins: number
  masteryPoints: number
  masteryLevel: number
  /** 1 a 5, calculado pelas regras de `comfortFor` */
  comfort: number
  /** de onde veio a sugestão (aparece no diálogo) */
  reason: string
}

export interface PoolSuggestion {
  byRole: Record<Role, PoolCandidate[]>
  /** rotas mais jogadas, da principal para a secundária (vazio se não deu para separar) */
  mainRoles: Role[]
  gamesUsed: number
}

/** Filas que contam: normal às cegas e draft, ranqueadas solo e flex, partida rápida. ARAM, bots e modos rotativos ficam de fora. */
export const COUNTED_QUEUES = new Set([400, 420, 430, 440, 490])

/** Mínimo de pontos de maestria para sugerir um campeão sem partidas recentes na rota. */
const MASTERY_ONLY_MIN = 40_000
const MAX_PER_ROLE = 10

/**
 * Conforto de 1 a 5 = o quanto você conhece o campeão, não o quanto ganhou com ele (poucas partidas recentes dizem pouco
 * sobre habilidade, e quem é main costuma jogar justamente os campeões difíceis):
 *  - partidas na rota: 3+ = +0,5; 6+ = +1; 12+ = +1,5; 20+ = +2
 *  - maestria: 15 mil = +0,4; 40 mil = +0,8; 100 mil = +1,2; 300 mil = +1,6; 600 mil = +2
 *  - "mono": 8+ partidas e 40% ou mais das partidas da rota = +0,5
 *  - só um empurrão pela taxa de vitória, e com 10+ partidas: 60% ou mais = +0,5; 35% ou menos = −0,5
 * A soma começa em 1 e é arredondada. Quem tem muita prática E muita maestria nunca fica abaixo de 4 (5 com 20+ partidas
 * e 300 mil pontos), mesmo com a taxa de vitória ruim.
 */
export function comfortFor(games: number, wins: number, masteryPoints: number, roleShare = 0): number {
  let s = 1
  s += games >= 20 ? 2 : games >= 12 ? 1.5 : games >= 6 ? 1 : games >= 3 ? 0.5 : 0
  s += masteryPoints >= 600_000 ? 2 : masteryPoints >= 300_000 ? 1.6 : masteryPoints >= 100_000 ? 1.2 : masteryPoints >= 40_000 ? 0.8 : masteryPoints >= 15_000 ? 0.4 : 0
  if (games >= 8 && roleShare >= 0.4) s += 0.5
  if (games >= 10) {
    const wr = wins / games
    if (wr >= 0.6) s += 0.5
    else if (wr <= 0.35) s -= 0.5
  }
  let stars = Math.min(5, Math.max(1, Math.round(s)))
  if (games >= 20 && masteryPoints >= 300_000) stars = 5
  else if (games >= 12 && masteryPoints >= 100_000) stars = Math.max(stars, 4)
  return stars
}

const pct = (n: number): string => `${Math.round(n * 100)}%`
const fmtPoints = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n))

export function buildPoolSuggestion(
  games: AccountGame[],
  mastery: MasteryEntry[],
  /** rota mais comum do campeão nos dados de meta (para quem tem maestria alta mas nenhuma partida recente) */
  roleHint: (championId: number) => Role | null
): PoolSuggestion {
  const masteryOf = new Map(mastery.map((m) => [m.championId, m]))
  const stat = new Map<string, { championId: number; role: Role; games: number; wins: number }>()
  const roleGames: Record<string, number> = {}
  let counted = 0
  for (const g of games) {
    if (!g.role || g.championId <= 0) continue
    counted++
    roleGames[g.role] = (roleGames[g.role] ?? 0) + 1
    const key = `${g.championId}|${g.role}`
    const cur = stat.get(key) ?? { championId: g.championId, role: g.role, games: 0, wins: 0 }
    cur.games++
    if (g.win) cur.wins++
    stat.set(key, cur)
  }

  const byRole = { TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] } as Record<Role, PoolCandidate[]>
  const make = (championId: number, role: Role, gm: number, wins: number): PoolCandidate => {
    const share = counted > 0 && (roleGames[role] ?? 0) > 0 ? gm / (roleGames[role] ?? 1) : 0
    const m = masteryOf.get(championId)
    const points = m?.points ?? 0
    const parts: string[] = []
    if (gm > 0) parts.push(`${gm} ${gm === 1 ? 'partida' : 'partidas'} recentes (${pct(wins / gm)} de vitórias)`)
    if (points > 0) parts.push(`maestria ${fmtPoints(points)}`)
    return { championId, role, games: gm, wins, masteryPoints: points, masteryLevel: m?.level ?? 0, comfort: comfortFor(gm, wins, points, share), reason: parts.join(' · ') }
  }

  const seen = new Set<string>()
  for (const s of stat.values()) {
    if (s.games < 2) continue
    byRole[s.role].push(make(s.championId, s.role, s.games, s.wins))
    seen.add(`${s.championId}|${s.role}`)
  }
  // quem tem muita maestria mas não apareceu nas partidas recentes entra na rota mais comum do campeão
  for (const m of mastery) {
    if (m.points < MASTERY_ONLY_MIN) continue
    if (ROLES.some((r) => seen.has(`${m.championId}|${r}`))) continue
    const role = roleHint(m.championId)
    if (role) byRole[role].push(make(m.championId, role, 0, 0))
  }
  for (const r of ROLES) {
    byRole[r] = byRole[r]
      .sort((a, b) => b.comfort - a.comfort || b.games - a.games || b.masteryPoints - a.masteryPoints)
      .slice(0, MAX_PER_ROLE)
  }

  const mainRoles = ROLES.filter((r) => counted > 0 && (roleGames[r] ?? 0) / counted >= 0.2)
    .sort((a, b) => (roleGames[b] ?? 0) - (roleGames[a] ?? 0))
    .slice(0, 2)
  return { byRole, mainRoles, gamesUsed: counted }
}

export interface ApplyOptions {
  /** também atualiza o conforto de quem já está na Pool (padrão: não mexe) */
  updateComfort: boolean
}

/** Junta as sugestões marcadas à Pool atual: mantém o que existe (e as anotações) e acrescenta o que faltava. */
export function applySuggestion(
  pool: Pool,
  picked: PoolCandidate[],
  keyOf: (championId: number) => string,
  opts: ApplyOptions
): Pool {
  const out = structuredClone(pool)
  for (const c of picked) {
    const list = out[c.role]
    const existing = list.find((e) => e.championId === c.championId)
    if (existing) {
      if (opts.updateComfort) existing.comfort = c.comfort
    } else {
      const entry: PoolEntry = { championId: c.championId, championKey: keyOf(c.championId), comfort: c.comfort }
      list.push(entry)
    }
  }
  return out
}

export type PoolSuggestResult =
  | { ok: true; account: string | null; suggestion: PoolSuggestion }
  | { ok: false; message: string }
