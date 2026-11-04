import { describe, expect, it } from 'vitest'
import { guessRole } from '../src/shared/roleGuess'
import type { DraftState } from '../src/shared/types'
import type { FriendProfile } from '../src/shared/dataTypes'

const e = (championId: number, comfort = 3) => ({ championId, championKey: 'X', comfort })
const profile = (pool: Partial<Record<string, ReturnType<typeof e>[]>>, mainRoles: string[] = []) =>
  ({ id: 'p', nickname: 'n', mainRoles, pool: { TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [], ...pool } }) as unknown as FriendProfile
const draft = (allies: { cellId: number; role: string | null }[]) =>
  ({ localPlayerCellId: 0, localRole: null, allies: allies.map((a) => ({ championId: 0, status: 'picking', ...a })), enemies: [], bans: { allies: [], enemies: [] }, phase: 'BAN_PICK' }) as unknown as DraftState

describe('guessRole', () => {
  it('a única rota livre é a sua, mesmo sem Pool nela', () => {
    const d = draft([{ cellId: 0, role: null }, { cellId: 1, role: 'TOP' }, { cellId: 2, role: 'JUNGLE' }, { cellId: 3, role: 'MIDDLE' }, { cellId: 4, role: 'BOTTOM' }])
    expect(guessRole(d, profile({ TOP: [e(1)] }))).toBe('UTILITY')
  })
  it('remove rotas ocupadas e fica com a que a Pool cobre', () => {
    const d = draft([{ cellId: 0, role: null }, { cellId: 1, role: 'TOP' }])
    expect(guessRole(d, profile({ TOP: [e(1, 5)], MIDDLE: [e(2, 4)] }))).toBe('MIDDLE')
  })
  it('usa a rota principal para desempatar e pergunta quando está equilibrado', () => {
    const d = draft([{ cellId: 0, role: null }])
    expect(guessRole(d, profile({ TOP: [e(1, 4)], MIDDLE: [e(2, 4)] }, ['MIDDLE']))).toBe('MIDDLE')
    expect(guessRole(d, profile({ TOP: [e(1, 4)], MIDDLE: [e(2, 4)] }))).toBeNull()
  })
  it('sem Pool em nenhuma rota livre, não chuta', () => {
    expect(guessRole(draft([{ cellId: 0, role: null }]), profile({}))).toBeNull()
  })
})
