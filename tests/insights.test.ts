// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildInsights } from '../src/main/data/insights'
import { type FriendProfile, type MetaDataset, type RoleMeta, type WinStats } from '../src/shared/dataTypes'
import { emptyPool } from '../src/shared/poolShare'
import type { DraftPlayer, DraftState, Role } from '../src/shared/types'

const w = (games: number, wins: number): WinStats => ({ games, wins })
const rm = (games: number, wins: number, extra: Partial<RoleMeta> = {}): RoleMeta => ({ games, wins, matchups: {}, ...extra })
const names: Record<number, string> = { 1: 'Lulu', 2: 'Jinx', 3: 'Caitlyn', 4: 'Leona', 5: 'Zed' }

// 1 = Lulu (sup, você), 2 = Jinx (ADC aliada), 3 = Caitlyn (ADC inimiga), 4 = Leona (sup inimiga)
const DS: MetaDataset = {
  schemaVersion: 1,
  source: 'real',
  patch: '16.22',
  generatedAt: '',
  champions: {
    '1': { roles: { UTILITY: rm(2000, 1100, { matchups: { '4': w(100, 40) }, synergies: { '2': w(300, 180) } }) } },
    '2': { roles: { BOTTOM: rm(2000, 1000, { matchups: { '3': w(80, 30) } }) } },
    '3': { roles: { BOTTOM: rm(2000, 1000) } },
    '4': { roles: { UTILITY: rm(2000, 1000, { synergies: { '3': w(200, 120) } }) } },
    '5': { roles: { MIDDLE: rm(2000, 1000) } }
  }
}

const pl = (cellId: number, championId: number, role: Role | null): DraftPlayer => ({ cellId, championId, role, status: 'locked' }) as DraftPlayer
const draft = (): DraftState =>
  ({
    phase: 'BAN_PICK',
    localPlayerCellId: 0,
    localRole: 'UTILITY',
    allies: [pl(0, 1, 'UTILITY'), pl(1, 2, 'BOTTOM')],
    enemies: [pl(5, 3, 'BOTTOM'), pl(6, 4, 'UTILITY'), pl(7, 5, null)],
    bans: { allies: [], enemies: [] }
  }) as DraftState
const base = { nameOf: (id: number) => names[id] ?? `#${id}`, roleLabel: (r: Role) => (r === 'UTILITY' ? 'Suporte' : r) }

describe('confronto de rota e dupla', () => {
  it('suporte: mostra a dupla, os cruzamentos e os pontos fortes e fracos', () => {
    const r = buildInsights({ ...base, dataset: DS, draft: draft(), championId: 1, role: 'UTILITY', draftEnemyId: 4 })
    expect(r.enemyId).toBe(4)
    expect(r.duo).toMatchObject({ partnerId: 2, enemyCarryId: 3, enemySupportId: 4, ourGames: 300, enemyGames: 200 })
    expect(r.duo?.ourWinrate).toBeCloseTo(0.6)
    const strong = (r.strengths ?? []).join(' | ')
    const weak = (r.weaknesses ?? []).join(' | ')
    expect(strong).toContain('Dupla com Jinx')
    expect(strong).toContain('Forte no meta de Suporte')
    expect(weak).toContain('A dupla inimiga Caitlyn + Leona é forte')
    expect(weak).toContain('Jinx sofre contra Caitlyn')
    expect(weak).toContain('O suporte Leona leva a melhor')
    expect(r.winrate).toBeCloseTo(0.4)
  })

  it('a simulação escolhida na busca vale mais que o oponente do draft; sem dados reais nada é inventado', () => {
    const sim = buildInsights({ ...base, dataset: DS, draft: draft(), championId: 1, role: 'UTILITY', draftEnemyId: 4, simEnemyId: 3 })
    expect(sim).toMatchObject({ enemyId: 3, simulated: true })
    const sample = buildInsights({ ...base, dataset: { ...DS, isSample: true }, draft: draft(), championId: 1, role: 'UTILITY', draftEnemyId: 4 })
    expect(sample).toMatchObject({ enemyId: null, winrate: null, strengths: [], weaknesses: [] })
  })

  it('rota solo: sem dupla; conforto e Pool entram nos pontos', () => {
    const profile = { id: 'p', nickname: 'Eu', mainRoles: [], pool: { ...emptyPool(), MIDDLE: [{ championId: 5, championKey: 'Zed', comfort: 5 }] } } as unknown as FriendProfile
    const d = { ...draft(), localRole: 'MIDDLE' as Role, allies: [pl(0, 5, 'MIDDLE')], enemies: [] }
    const r = buildInsights({ ...base, dataset: DS, draft: d, championId: 5, role: 'MIDDLE', profile })
    expect(r.duo).toBeUndefined()
    expect((r.strengths ?? []).join(' | ')).toContain('conforto alto')
    const off = buildInsights({ ...base, dataset: DS, draft: d, championId: 1, role: 'MIDDLE', profile })
    expect((off.weaknesses ?? []).join(' | ')).toContain('não está na sua Pool')
  })
})
