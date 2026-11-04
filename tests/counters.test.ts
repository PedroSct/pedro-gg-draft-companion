import { describe, expect, it } from 'vitest'
import { laneEnemy, suggestMetaCounters } from '../src/main/data/counters'
import type { DraftState } from '../src/shared/types'
import type { FriendProfile, MetaDataset } from '../src/shared/dataTypes'

const mid = (games: number, wins: number, matchups: Record<string, { games: number; wins: number }> = {}) => ({ games, wins, matchups })
const ds: MetaDataset = {
  schemaVersion: 1,
  source: 'test',
  patch: '16.1',
  generatedAt: '2026-01-01',
  champions: {
    '1': { roles: { MIDDLE: mid(1000, 500) } }, // inimigo (Annie)
    '2': { roles: { MIDDLE: mid(1000, 520, { '1': { games: 100, wins: 62 } }) } }, // counter forte
    '3': { roles: { MIDDLE: mid(1000, 500, { '1': { games: 100, wins: 57 } }) } }, // counter, mas está na Pool
    '4': { roles: { MIDDLE: mid(1000, 500, { '1': { games: 10, wins: 9 } }) } }, // poucos jogos
    '5': { roles: { TOP: mid(1000, 500), MIDDLE: mid(50, 30, { '1': { games: 100, wins: 70 } }) } }, // quase não joga mid
    '6': { roles: { MIDDLE: mid(1000, 500) } } // sem dado contra o inimigo, só o espelho
  }
}
ds.champions['1']!.roles.MIDDLE!.matchups['6'] = { games: 80, wins: 28 } // 6 vence 52 de 80

const draft = (over: Partial<DraftState> = {}): DraftState =>
  ({
    phase: 'BAN_PICK',
    localPlayerCellId: 0,
    localRole: 'MIDDLE',
    allies: [{ cellId: 0, championId: 0, status: 'picking', role: 'MIDDLE' }],
    enemies: [{ cellId: 5, championId: 1, status: 'locked', role: null }],
    bans: { allies: [], enemies: [] },
    ...over
  }) as unknown as DraftState

const profile = { id: 'p', nickname: 'x', pool: { TOP: [], JUNGLE: [], MIDDLE: [{ championId: 3, championKey: 'C', comfort: 4 }], BOTTOM: [], UTILITY: [] } } as unknown as FriendProfile

describe('suggestMetaCounters', () => {
  it('acha o inimigo da rota quando só ele joga mid', () => {
    expect(laneEnemy(draft(), ds, 'MIDDLE')).toBe(1)
  })
  it('sugere o melhor counter fora da Pool, ignora pouco dado e quem não joga a rota', () => {
    const r = suggestMetaCounters({ draft: draft(), dataset: ds, profile, role: 'MIDDLE' })
    expect(r.map((c) => c.championId)).toEqual([6, 2]) // 6 usa o dado espelhado: 52/80
    expect(r[1]).toMatchObject({ enemyId: 1, games: 100 })
    expect(r[1].winrate).toBeCloseTo(0.62)
  })
  it('não sugere quem já foi escolhido ou banido', () => {
    const d = draft({ bans: { allies: [2], enemies: [] } })
    expect(suggestMetaCounters({ draft: d, dataset: ds, profile, role: 'MIDDLE' }).map((c) => c.championId)).toEqual([6])
  })
  it('sem inimigo conhecido, sem dataset ou com amostra: lista vazia', () => {
    expect(suggestMetaCounters({ draft: draft({ enemies: [] }), dataset: ds, profile, role: 'MIDDLE' })).toEqual([])
    expect(suggestMetaCounters({ draft: draft(), dataset: null, profile, role: 'MIDDLE' })).toEqual([])
    expect(suggestMetaCounters({ draft: draft(), dataset: { ...ds, isSample: true }, profile, role: 'MIDDLE' })).toEqual([])
  })
})
