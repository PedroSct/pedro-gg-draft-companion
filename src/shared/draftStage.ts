// src/shared/draftStage.ts
// Em que etapa a seleção de campeões está: bans, picks ou (depois de travar o seu) build.
import type { DraftState } from './types'

export type DraftStage = 'ban' | 'pick' | 'build'

/** O draft ainda está na fase de banimentos? (com picks travados não faz mais sentido sugerir ban) */
export function banPhaseOpen(draft: DraftState): boolean {
  if (draft.phase === 'PLANNING') return true
  if (draft.phase !== 'BAN_PICK') return false
  const bans = draft.bans.allies.length + draft.bans.enemies.length
  const locked = [...draft.allies, ...draft.enemies].some((p) => p.status === 'locked')
  return bans < 10 && !locked
}

export function draftStage(draft: DraftState): DraftStage {
  const me = draft.allies.find((p) => p.cellId === draft.localPlayerCellId)
  if (draft.turn?.type === 'ban') return 'ban'
  if (me && me.status === 'locked' && me.championId > 0) return 'build'
  if (draft.turn?.type === 'pick') return 'pick'
  return banPhaseOpen(draft) ? 'ban' : 'pick'
}
