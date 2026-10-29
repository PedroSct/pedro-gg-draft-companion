// src/main/lcu/champSelect.ts
// Converte o JSON cru de /lol-champ-select/v1/session em um DraftState enxuto.
import type {
  DraftPhase,
  DraftPlayer,
  DraftState,
  PickStatus,
  Role
} from '../../shared/types'

interface RawPlayer {
  cellId: number
  championId?: number
  championPickIntent?: number
  assignedPosition?: string
  puuid?: string
}

interface RawAction {
  actorCellId: number
  championId: number
  completed: boolean
  isAllyAction?: boolean
  type: string
}

interface RawSession {
  localPlayerCellId?: number
  myTeam?: RawPlayer[]
  theirTeam?: RawPlayer[]
  actions?: RawAction[][]
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] }
  timer?: { phase?: string }
}

const ROLES: Record<string, Role> = {
  top: 'TOP',
  jungle: 'JUNGLE',
  middle: 'MIDDLE',
  bottom: 'BOTTOM',
  utility: 'UTILITY'
}

const PHASES: readonly DraftPhase[] = ['PLANNING', 'BAN_PICK', 'FINALIZATION', 'GAME_STARTING']

const isPositive = (n: unknown): n is number => typeof n === 'number' && n > 0
const uniquePositive = (xs: unknown[] | undefined): number[] => [
  ...new Set((xs ?? []).filter(isPositive))
]

function toPlayer(p: RawPlayer, picks: RawAction[]): DraftPlayer {
  const action = picks.find((a) => a.actorCellId === p.cellId)

  // Prioridade: campeão atual > hover da ação de pick > intenção declarada (planning)
  const championId = [p.championId, action?.championId, p.championPickIntent].find(isPositive) ?? 0

  let status: PickStatus = 'none'
  if (championId > 0) {
    // Modos sem ações de pick (ARAM etc.): campeão presente = definitivo.
    status = action ? (action.completed ? 'locked' : 'hovering') : 'locked'
  }

  return {
    cellId: p.cellId,
    championId,
    status,
    role: ROLES[(p.assignedPosition ?? '').toLowerCase()] ?? null,
    puuid: p.puuid || undefined
  }
}

export function normalizeSession(data: unknown): DraftState | null {
  if (!data || typeof data !== 'object') return null
  const s = data as RawSession
  if (!Array.isArray(s.myTeam) || !Array.isArray(s.theirTeam)) return null

  const actions = (s.actions ?? []).flat()
  const picks = actions.filter((a) => a.type === 'pick')

  const byCell = (a: DraftPlayer, b: DraftPlayer): number => a.cellId - b.cellId
  const allies = s.myTeam.map((p) => toPlayer(p, picks)).sort(byCell)
  const enemies = s.theirTeam.map((p) => toPlayer(p, picks)).sort(byCell)

  let allyBans = uniquePositive(s.bans?.myTeamBans)
  let enemyBans = uniquePositive(s.bans?.theirTeamBans)
  if (!allyBans.length && !enemyBans.length) {
    // Alguns modos não preenchem 'bans'; reconstrói pelas ações concluídas.
    const done = actions.filter((a) => a.type === 'ban' && a.completed && isPositive(a.championId))
    allyBans = uniquePositive(done.filter((a) => a.isAllyAction).map((a) => a.championId))
    enemyBans = uniquePositive(done.filter((a) => !a.isAllyAction).map((a) => a.championId))
  }

  const localPlayerCellId = s.localPlayerCellId ?? -1
  const phase = PHASES.find((p) => p === s.timer?.phase) ?? 'UNKNOWN'

  return {
    phase,
    localPlayerCellId,
    localRole: allies.find((p) => p.cellId === localPlayerCellId)?.role ?? null,
    allies,
    enemies,
    bans: { allies: allyBans, enemies: enemyBans }
  }
}
