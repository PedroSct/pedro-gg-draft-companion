import { describe, expect, it } from 'vitest'
import { banPhaseOpen, draftStage } from '../src/shared/draftStage'
import type { DraftState } from '../src/shared/types'

const p = (cellId: number, championId: number, status: 'none' | 'hovering' | 'locked') => ({ cellId, championId, status, role: null })
const base = (): DraftState => ({
  phase: 'BAN_PICK',
  localPlayerCellId: 0,
  localRole: 'MIDDLE',
  allies: [p(0, 0, 'none')],
  enemies: [p(5, 0, 'none')],
  bans: { allies: [], enemies: [] }
})

describe('draftStage', () => {
  it('bans enquanto ninguém travou e há bans a fazer', () => {
    expect(draftStage(base())).toBe('ban')
    expect(draftStage({ ...base(), phase: 'PLANNING' })).toBe('ban')
  })
  it('na sua vez de banir é sempre ban', () => {
    expect(draftStage({ ...base(), turn: { id: 1, type: 'ban', championId: 0 } })).toBe('ban')
  })
  it('picks quando alguém já travou ou os 10 bans acabaram', () => {
    expect(draftStage({ ...base(), enemies: [p(5, 238, 'locked')] })).toBe('pick')
    expect(banPhaseOpen({ ...base(), bans: { allies: [1, 2, 3, 4, 5], enemies: [6, 7, 8, 9, 10] } })).toBe(false)
  })
  it('build depois de travar o seu campeão', () => {
    expect(draftStage({ ...base(), allies: [p(0, 103, 'locked')] })).toBe('build')
  })
})
