import { describe, expect, it } from 'vitest'
import { diffSnapshots, patchNotice, snapshotOf } from '../src/main/data/patchChanges'
import type { FriendProfile, MetaDataset } from '../src/shared/dataTypes'

const ds = (patch: string, a: { games: number; wins: number }, core = 3000, regions: string[] = ['br1']): MetaDataset => ({
  schemaVersion: 1, source: 't', patch, generatedAt: '2026-01-01', regions,
  champions: {
    '1': { roles: { MIDDLE: { ...a, matchups: {}, build: { items: { starting: [], boots: [], core: [core], situational: [] } } } as never } },
    '2': { roles: { MIDDLE: { games: 1000, wins: 500, matchups: {} } } },
    '3': { roles: { MIDDLE: { games: 1000, wins: 500, matchups: {} } } }
  }
})
const profile = { id: 'p', nickname: 'n', mainRoles: [], pool: { TOP: [], JUNGLE: [], MIDDLE: [{ championId: 1, championKey: 'A', comfort: 4 }], BOTTOM: [], UTILITY: [] } } as unknown as FriendProfile

describe('mudanças de patch', () => {
  it('avisa tier, winrate e item do campeão da Pool, e ignora quem não está nela', () => {
    const prev = snapshotOf(ds('16.1', { games: 2000, wins: 1000 }))
    const cur = snapshotOf(ds('16.2', { games: 2000, wins: 1100 }, 3100))
    const ch = diffSnapshots(prev, cur, [profile])
    expect(ch).toHaveLength(1)
    expect(ch[0]).toMatchObject({ championId: 1, coreFrom: 3000, coreTo: 3100 })
    expect(ch[0].toTier).not.toBe(ch[0].fromTier)
  })
  it('primeira vez, mesmo patch e outra região não avisam; patch novo sem mudança só marca como visto', () => {
    const a = ds('16.1', { games: 2000, wins: 1000 })
    expect(patchNotice(null, a, [profile])).toEqual({ notice: null, ack: true })
    expect(patchNotice(snapshotOf(a), a, [profile])).toEqual({ notice: null, ack: false })
    expect(patchNotice(snapshotOf(a), ds('16.2', { games: 2000, wins: 1200 }, 3100, ['kr']), [profile])).toEqual({ notice: null, ack: true })
    expect(patchNotice(snapshotOf(a), ds('16.2', { games: 2000, wins: 1000 }), [profile])).toEqual({ notice: null, ack: true })
  })
  it('devolve o aviso quando o patch muda e algo mexeu', () => {
    const r = patchNotice(snapshotOf(ds('16.1', { games: 2000, wins: 1000 })), ds('16.2', { games: 2000, wins: 1100 }), [profile])
    expect(r.notice).toMatchObject({ fromPatch: '16.1', toPatch: '16.2' })
    expect(r.ack).toBe(false)
  })
  it('amostra de exemplo nunca avisa', () => {
    expect(patchNotice(null, { ...ds('16.1', { games: 2000, wins: 1000 }), isSample: true }, [profile])).toEqual({ notice: null, ack: false })
  })
})
