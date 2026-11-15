// src/main/data/insights.ts
// Confronto de rota em destaque: oponente, dupla (ADC + suporte) e pontos fortes e fracos, tudo tirado dos dados de meta.
// Função pura: sem I/O. Os textos já saem em português.
import type { DraftState, Role } from '../../shared/types'
import { ROLES, type DuoInfo, type FriendProfile, type LaneMatchup, type MetaDataset, type WinStats } from '../../shared/dataTypes'
import { tierOf } from './metaStats'

export const ROLE_NAMES: Record<Role, string> = { TOP: 'Top', JUNGLE: 'Selva', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Suporte' }

const MIN_GAMES = 10
const PRIOR = 30
const STRONG = 0.53
const WEAK = 0.47
const MIN_ENEMY_SHARE = 0.5

const smooth = (s: WinStats, prior = PRIOR): number => (s.wins + prior / 2) / (s.games + prior)
const pctText = (x: number): string => `${(x * 100).toFixed(1).replace('.', ',')}%`

function share(ds: MetaDataset, id: number, role: Role): number {
  const roles = ds.champions[String(id)]?.roles
  if (!roles) return 0
  const total = ROLES.reduce((n, r) => n + (roles[r]?.games ?? 0), 0)
  return total > 0 ? (roles[role]?.games ?? 0) / total : 0
}

/** Estatística de `id` contra `vs` na mesma rota (usa o espelho se só o outro lado tiver dado). */
function lane(ds: MetaDataset, id: number, role: Role, vs: number): WinStats | null {
  const direct = ds.champions[String(id)]?.roles[role]?.matchups[String(vs)]
  if (direct && direct.games > 0) return direct
  const mirror = ds.champions[String(vs)]?.roles[role]?.matchups[String(id)]
  return mirror && mirror.games > 0 ? { games: mirror.games, wins: mirror.games - mirror.wins } : null
}

/** Quem do time inimigo joga `role` (rota informada ou a que mais joga), sem repetir `except`. */
function enemyIn(draft: DraftState, ds: MetaDataset, role: Role, except: number[] = []): number | null {
  let best: { id: number; score: number } | null = null
  for (const e of draft.enemies) {
    if (e.championId <= 0 || except.includes(e.championId)) continue
    if (e.role && e.role !== role) continue
    const score = e.role === role ? 1 : share(ds, e.championId, role)
    if (score < MIN_ENEMY_SHARE) continue
    if (!best || score > best.score) best = { id: e.championId, score }
  }
  return best?.id ?? null
}

export interface InsightsInput {
  dataset: MetaDataset | null
  draft: DraftState
  championId: number
  role: Role
  /** oponente escolhido pela busca (vale mais que o palpite do draft) */
  simEnemyId?: number | null
  /** oponente de rota que o draft já aponta com segurança (laneEnemyOf) */
  draftEnemyId?: number | null
  profile?: FriendProfile
  nameOf: (id: number) => string
  roleLabel: (role: Role) => string
}

export function buildInsights(input: InsightsInput): LaneMatchup {
  const { dataset: ds, draft, championId, role, nameOf } = input
  const empty: LaneMatchup = { enemyId: null, simulated: false, winrate: null, games: 0, strengths: [], weaknesses: [] }
  if (!ds || ds.isSample) return input.simEnemyId ? { ...empty, enemyId: input.simEnemyId, simulated: true } : empty

  const strengths: string[] = []
  const weaknesses: string[] = []
  const enemyId = input.simEnemyId ?? input.draftEnemyId ?? null
  const mine = ds.champions[String(championId)]?.roles[role]

  // Rota: você contra o oponente
  const st = enemyId ? lane(ds, championId, role, enemyId) : null
  const winrate = st && st.games >= 5 ? st.wins / st.games : null
  if (enemyId && st && st.games >= MIN_GAMES) {
    const wr = smooth(st)
    if (wr >= STRONG) strengths.push(`Vence ${nameOf(enemyId)} em ${pctText(st.wins / st.games)} do confronto (${st.games} jogos)`)
    else if (wr <= WEAK) weaknesses.push(`Perde para ${nameOf(enemyId)}: só ${pctText(st.wins / st.games)} do confronto (${st.games} jogos)`)
  }

  // Força do campeão na rota
  if (mine && mine.games >= 100) {
    const delta = (smooth(mine, 300) - 0.5) * 100
    const tier = tierOf(delta)
    if (tier === 'S' || tier === 'A') strengths.push(`Forte no meta de ${input.roleLabel(role)}: tier ${tier} (${pctText(mine.wins / mine.games)})`)
    else if (tier === 'D' || tier === 'C') weaknesses.push(`Fraco no meta de ${input.roleLabel(role)} neste patch: tier ${tier} (${pctText(mine.wins / mine.games)})`)
  }

  // Conforto com o campeão
  const entry = input.profile?.pool[role]?.find((e) => e.championId === championId)
  if (entry && entry.comfort >= 4) strengths.push(`Você tem conforto alto com este campeão (${entry.comfort}/5)`)
  else if (entry && entry.comfort <= 2) weaknesses.push(`Você tem pouca prática com este campeão (${entry.comfort}/5)`)
  else if (!entry && input.profile) weaknesses.push('Este campeão não está na sua Pool para esta rota')

  // Dupla da bot lane
  let duo: DuoInfo | undefined
  if (role === 'BOTTOM' || role === 'UTILITY') {
    const partnerRole: Role = role === 'BOTTOM' ? 'UTILITY' : 'BOTTOM'
    const partner = draft.allies.find((a) => a.cellId !== draft.localPlayerCellId && a.championId > 0 && a.role === partnerRole)
    const enemyCarry = enemyIn(draft, ds, 'BOTTOM')
    const enemySupport = enemyIn(draft, ds, 'UTILITY', enemyCarry ? [enemyCarry] : [])
    if (partner || enemyCarry || enemySupport) {
      const ours = partner ? mine?.synergies?.[String(partner.championId)] : undefined
      const theirs = enemyCarry && enemySupport ? (ds.champions[String(enemySupport)]?.roles.UTILITY?.synergies?.[String(enemyCarry)] ?? ds.champions[String(enemyCarry)]?.roles.BOTTOM?.synergies?.[String(enemySupport)]) : undefined
      duo = {
        partnerId: partner?.championId ?? null,
        partnerRole,
        enemyCarryId: enemyCarry,
        enemySupportId: enemySupport,
        ourWinrate: ours && ours.games >= MIN_GAMES ? ours.wins / ours.games : null,
        ourGames: ours?.games ?? 0,
        enemyWinrate: theirs && theirs.games >= MIN_GAMES ? theirs.wins / theirs.games : null,
        enemyGames: theirs?.games ?? 0
      }
      if (partner && ours && ours.games >= MIN_GAMES) {
        const wr = smooth(ours)
        if (wr >= STRONG) strengths.push(`Dupla com ${nameOf(partner.championId)}: vencem ${pctText(ours.wins / ours.games)} juntos (${ours.games} jogos)`)
        else if (wr <= WEAK) weaknesses.push(`Dupla com ${nameOf(partner.championId)} rende pouco: ${pctText(ours.wins / ours.games)} juntos (${ours.games} jogos)`)
      }
      if (enemyCarry && enemySupport && theirs && theirs.games >= MIN_GAMES) {
        const wr = smooth(theirs)
        if (wr >= STRONG) weaknesses.push(`A dupla inimiga ${nameOf(enemyCarry)} + ${nameOf(enemySupport)} é forte: ${pctText(theirs.wins / theirs.games)} juntos`)
        else if (wr <= WEAK) strengths.push(`A dupla inimiga ${nameOf(enemyCarry)} + ${nameOf(enemySupport)} rende pouco: ${pctText(theirs.wins / theirs.games)} juntos`)
      }
      // Cruzamentos: seu parceiro contra o carry inimigo (ou você contra o carry, se for o suporte)
      if (partner && enemyCarry && partnerRole === 'BOTTOM') {
        const x = lane(ds, partner.championId, 'BOTTOM', enemyCarry)
        if (x && x.games >= MIN_GAMES) {
          const wr = smooth(x)
          if (wr >= STRONG) strengths.push(`${nameOf(partner.championId)} vence ${nameOf(enemyCarry)} em ${pctText(x.wins / x.games)} da rota`)
          else if (wr <= WEAK) weaknesses.push(`${nameOf(partner.championId)} sofre contra ${nameOf(enemyCarry)}: ${pctText(x.wins / x.games)} da rota`)
        }
      }
      if (role === 'UTILITY' && enemySupport) {
        const x = lane(ds, championId, 'UTILITY', enemySupport)
        if (x && x.games >= MIN_GAMES) {
          const wr = smooth(x)
          if (wr >= STRONG) strengths.push(`Você vence o suporte ${nameOf(enemySupport)} em ${pctText(x.wins / x.games)} do confronto`)
          else if (wr <= WEAK) weaknesses.push(`O suporte ${nameOf(enemySupport)} leva a melhor: você faz ${pctText(x.wins / x.games)} do confronto`)
        }
      }
    }
  }

  return { enemyId, simulated: input.simEnemyId != null, winrate, games: st?.games ?? 0, ...(duo ? { duo } : {}), strengths, weaknesses }
}
