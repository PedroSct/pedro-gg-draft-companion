// @vitest-environment node
// 0.5.1: perfil de dano/tanque/CC, confronto contra o time inimigo, variantes de build, juntar servidores,
// recomendação por composição e build ajustada à partida.
import { describe, expect, it } from 'vitest'
import { addMatch, finalize, itemRulesFrom, mergeStates, newState, type RawEvent, type RawMatch, type RawParticipant } from '../tools/meta/aggregate'
import { validateDataset } from '../src/main/data/meta'
import { recommend } from '../src/main/data/recommender'
import { buildSituation } from '../src/main/data/situation'
import { estimateTraits, traitsOf } from '../src/shared/traits'
import { emptyPool } from '../src/shared/poolShare'
import type { ChampionBuild, ChampionInfo, FriendProfile, ItemInfo, MetaDataset, RoleMeta } from '../src/shared/dataTypes'
import type { DraftPlayer, DraftState, Role } from '../src/shared/types'

const ROLES5: Role[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const rules = itemRulesFrom({
  data: {
    '3089': { gold: { total: 3600, purchasable: true }, tags: [], from: ['1026'], maps: { '11': true } },
    '3157': { gold: { total: 3000, purchasable: true }, tags: [], from: ['1026'], maps: { '11': true } },
    '3020': { gold: { total: 1100 }, tags: ['Boots'], from: ['1001'], maps: { '11': true } },
    '6653': { gold: { total: 3200, purchasable: true }, tags: [], from: ['1026'], maps: { '11': true } }
  }
})

function match(over: (i: number) => Partial<RawParticipant>, blueWins = true): RawMatch {
  return {
    info: {
      gameVersion: '16.21.1.1',
      queueId: 420,
      gameDuration: 1800, // 30 min
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        championId: i + 1,
        teamId: i < 5 ? 100 : 200,
        teamPosition: ROLES5[i % 5],
        win: (i < 5) === blueWins,
        ...over(i)
      }))
    }
  }
}

describe('coleta: perfil, contra o time inimigo e variantes', () => {
  it('soma dano por tipo, tanque e CC por campeão e rota', () => {
    const s = newState('16.21')
    for (let n = 0; n < 2; n++) {
      addMatch(
        s,
        match((i) => ({
          physicalDamageDealtToChampions: i === 0 ? 30_000 : 0,
          magicDamageDealtToChampions: i === 0 ? 10_000 : 20_000,
          trueDamageDealtToChampions: 0,
          totalDamageTaken: 20_000,
          damageSelfMitigated: 10_000,
          timeCCingOthers: 60
        })),
        null,
        rules
      )
    }
    const p = s.champions['1'].TOP!.prof!
    expect(p.n).toBe(2)
    expect(p.minutes).toBe(60)
    expect(p.physical).toBe(60_000)
    expect(p.magic).toBe(20_000)
    const ds = finalize(s, { minGames: 1, minMatchupGames: 1, minBuildSamples: 1, source: 't', generatedAt: '' })
    // poucos jogos para perfil confiável: só entra com 20+ partidas
    expect(ds.champions['1'].roles.TOP!.profile).toBeUndefined()
    p.n = 25
    const ds2 = finalize(s, { minGames: 1, minMatchupGames: 1, minBuildSamples: 1, source: 't', generatedAt: '' })
    expect(ds2.champions['1'].roles.TOP!.profile).toEqual({ physical: 0.75, magic: 0.25, true: 0, durability: 1000, cc: 2 })
  })

  it('conta o desempenho contra cada campeão inimigo, em qualquer rota', () => {
    const s = newState('16.21')
    addMatch(s, match(() => ({})), null, rules)
    addMatch(s, match(() => ({}), false), null, rules)
    const v = s.champions['1'].TOP!.versus!
    expect(Object.keys(v).sort()).toEqual(['10', '6', '7', '8', '9'])
    expect(v['9']).toEqual({ games: 2, wins: 1 }) // campeão 9 joga de atirador no time inimigo, outra rota
    expect(s.champions['1'].TOP!.versus!['2']).toBeUndefined() // aliado não entra
    const ds = finalize(s, { minGames: 1, minMatchupGames: 2, minBuildSamples: 1, source: 't', generatedAt: '', regions: ['br1'] })
    const checked = validateDataset(JSON.parse(JSON.stringify(ds)))
    expect(checked.champions['1'].roles.TOP!.versus!['9']).toEqual({ games: 2, wins: 1 })
    expect(checked.regions).toEqual(['br1'])
  })

  it('guarda as construções alternativas e descarta as raras', () => {
    const s = newState('16.21')
    const buy = (items: number[]): RawEvent[] =>
      items.map((itemId, k) => ({ type: 'ITEM_PURCHASED', participantId: 1, itemId, timestamp: 100_000 * (k + 1) }))
    const timeline = (items: number[]) => ({ info: { frames: [{ events: buy(items) }] } })
    for (let n = 0; n < 8; n++) addMatch(s, match(() => ({})), timeline([3020, 3089, 3157, 6653]), rules)
    for (let n = 0; n < 6; n++) addMatch(s, match(() => ({})), timeline([3020, 3157, 3089, 6653]), rules)
    addMatch(s, match(() => ({})), timeline([3020, 6653, 3089, 3157]), rules) // 1 de 15: rara
    const b = s.champions['1'].TOP!.build
    expect(b.variants).toEqual({ '3089,3157,6653|3020': 8, '3157,3089,6653|3020': 6, '6653,3089,3157|3020': 1 })
    // sem habilidades válidas não há build publicável: o teste só olha o contador
  })

  it('junta dois servidores somando as contagens e ignora outro patch', () => {
    const a = newState('16.21')
    const b = newState('16.21')
    const old = newState('16.20')
    addMatch(a, match(() => ({ physicalDamageDealtToChampions: 100 })), null, rules)
    addMatch(b, match(() => ({ physicalDamageDealtToChampions: 100 })), null, rules)
    addMatch(b, match(() => ({}), false), null, rules)
    old.matches = 9
    const { merged, used, skipped } = mergeStates([a, b, old])
    expect(used).toEqual([0, 1])
    expect(skipped).toEqual([2])
    expect(merged.matches).toBe(3)
    expect(merged.champions['1'].TOP).toMatchObject({ games: 3, wins: 2 })
    expect(merged.champions['1'].TOP!.versus!['6']).toEqual({ games: 3, wins: 2 })
    expect(merged.champions['1'].TOP!.prof!.n).toBe(2)
    expect(a.matches).toBe(1) // não altera os originais
    expect(a.champions['1'].TOP!.games).toBe(1)
  })

  it('arquivo antigo (sem os campos novos) continua válido', () => {
    const ds = validateDataset({
      schemaVersion: 1, patch: '16.20', source: 'x', generatedAt: '',
      champions: { '1': { roles: { TOP: { games: 10, wins: 5, matchups: {}, versus: { x: { games: 1, wins: 0 } }, profile: { physical: 2 } } } } }
    })
    expect(ds.champions['1'].roles.TOP).toEqual({ games: 10, wins: 5, matchups: {} }) // lixo é ignorado, nada quebra
  })
})

// ------------------------------------------------------------------------ recomendação

const info = (id: number, tags: string[], attack: number, magic: number, defense: number): ChampionInfo => ({
  id, key: `C${id}`, name: `C${id}`, iconUrl: '', tags, info: { attack, magic, defense, difficulty: 5 }
})
const CHAMPS: ChampionInfo[] = [
  info(10, ['Marksman'], 9, 2, 3), // atirador físico
  info(11, ['Fighter'], 8, 2, 5), // lutador físico
  info(12, ['Mage'], 2, 9, 3), // mago
  info(13, ['Mage'], 3, 9, 4), // mago
  info(14, ['Tank'], 4, 4, 9), // tanque
  info(15, ['Fighter'], 8, 2, 5),
  info(16, ['Marksman'], 9, 1, 2)
]

const player = (cellId: number, championId: number, role: Role | null, status: DraftPlayer['status'] = 'locked'): DraftPlayer =>
  ({ cellId, championId, role, status }) as DraftPlayer

function draftOf(allies: DraftPlayer[], enemies: DraftPlayer[]): DraftState {
  return {
    phase: 'PICKING', localPlayerCellId: 0, localRole: 'MIDDLE', allies, enemies, bans: { allies: [], enemies: [] }
  } as unknown as DraftState
}

function profileWith(ids: number[], role: Role): FriendProfile {
  const pool = emptyPool()
  pool[role] = ids.map((id) => ({ championId: id, championKey: `C${id}`, comfort: 3 }))
  return { id: 'p', nickname: 'P', notes: '', mainRoles: [role], pool } as unknown as FriendProfile
}

describe('recomendação por composição', () => {
  const allies = [player(0, 0, 'MIDDLE', 'none'), player(1, 10, 'BOTTOM'), player(2, 11, 'TOP'), player(3, 15, 'JUNGLE')]

  it('prefere trazer o dano que falta ao time (time todo físico → mago)', () => {
    const rec = recommend({
      draft: draftOf(allies, []),
      profile: profileWith([12, 16], 'MIDDLE'),
      dataset: null,
      role: 'MIDDLE',
      champions: CHAMPS
    })
    expect(rec.ranking[0].championId).toBe(12)
    expect(rec.ranking[0].compReasons).toContain('adds-magic')
    expect(rec.ranking[0].factors.comp).toBeGreaterThan(0)
    const phys = rec.ranking.find((r) => r.championId === 16)!
    expect(phys.factors.comp).toBeLessThan(rec.ranking[0].factors.comp)
    expect(phys.compReasons).toContain('too-much-physical')
  })

  it('valoriza frontline quando o time não tem', () => {
    const squishy = [player(0, 0, 'MIDDLE', 'none'), player(1, 10, 'BOTTOM'), player(2, 12, 'TOP'), player(3, 16, 'JUNGLE')]
    const rec = recommend({
      draft: draftOf(squishy, []),
      profile: profileWith([14, 13], 'MIDDLE'),
      dataset: null,
      role: 'MIDDLE',
      champions: CHAMPS
    })
    const tank = rec.ranking.find((r) => r.championId === 14)!
    expect(tank.compReasons).toContain('adds-frontline')
  })

  it('com poucos aliados conhecidos não mexe no score', () => {
    const rec = recommend({
      draft: draftOf([player(0, 0, 'MIDDLE', 'none'), player(1, 10, 'BOTTOM')], []),
      profile: profileWith([12], 'MIDDLE'),
      dataset: null,
      role: 'MIDDLE',
      champions: CHAMPS
    })
    expect(rec.ranking[0].factors.comp).toBe(0)
    expect(rec.ranking[0].compReasons).toEqual([])
  })

  it('usa o desempenho contra os campeões do time inimigo (fora da rota)', () => {
    const base: RoleMeta = { games: 1000, wins: 500, matchups: {} }
    const ds: MetaDataset = {
      schemaVersion: 1, source: 't', patch: '16.21', generatedAt: '',
      champions: {
        '12': { roles: { MIDDLE: { ...base, versus: { '20': { games: 200, wins: 130 }, '21': { games: 200, wins: 70 } } } } },
        '13': { roles: { MIDDLE: base } }
      }
    }
    const rec = recommend({
      draft: draftOf([player(0, 0, 'MIDDLE', 'none')], [player(5, 20, null), player(6, 21, null)]),
      profile: profileWith([12, 13], 'MIDDLE'),
      dataset: ds,
      role: 'MIDDLE',
      champions: CHAMPS
    })
    const a = rec.ranking.find((r) => r.championId === 12)!
    expect(a.versusList.map((v) => v.withChampionId).sort()).toEqual([20, 21])
    expect(a.versusList.find((v) => v.withChampionId === 20)!.delta).toBeGreaterThan(0)
    expect(a.versusList.find((v) => v.withChampionId === 21)!.delta).toBeLessThan(0)
    const none = rec.ranking.find((r) => r.championId === 13)!
    expect(none.versusDelta).toBeNull()
    expect(none.factors.versus).toBe(0)
  })
})

describe('traços dos campeões', () => {
  it('usa o perfil real quando existe e estima pelas notas quando não', () => {
    const ds: MetaDataset = {
      schemaVersion: 1, source: 't', patch: '16.21', generatedAt: '',
      champions: { '14': { roles: { TOP: { games: 100, wins: 50, matchups: {}, profile: { physical: 0.7, magic: 0.3, true: 0, durability: 3200, cc: 2.5 } } } } }
    }
    const map = new Map(CHAMPS.map((c) => [c.id, c]))
    const real = traitsOf(ds, map, 14, 'TOP')
    expect(real).toMatchObject({ physical: 0.7, durability: 1, cc: 1, source: 'data' })
    const est = traitsOf(ds, map, 12, 'MIDDLE')
    expect(est.source).toBe('estimate')
    expect(est.magic).toBeGreaterThan(0.7)
    expect(estimateTraits(undefined).physical).toBe(0.5)
  })
})

// ------------------------------------------------------------------ build para a partida

describe('build ajustada à partida', () => {
  const item = (id: number, tags: string[]): ItemInfo => ({ id, name: `I${id}`, iconUrl: '', goldTotal: 3000, tags })
  const items: Record<string, ItemInfo> = {
    '1': item(1, ['Damage']),
    '2': item(2, ['Armor']),
    '3': item(3, ['SpellBlock']),
    '4': item(4, ['ArmorPenetration']),
    '5': item(5, ['Damage'])
  }
  const build: ChampionBuild = {
    skillOrder: { priority: ['R', 'Q', 'W', 'E'] },
    items: {
      starting: [], boots: [], core: [1, 5, 4],
      situational: [{ itemId: 2, when: '' }, { itemId: 3, when: '' }]
    },
    variants: [
      { core: [1, 5, 4], share: 0.5 },
      { core: [1, 2, 3], share: 0.3 }
    ]
  }
  const run = (enemies: DraftPlayer[]) =>
    buildSituation({ dataset: null, draft: draftOf([], enemies), build, championId: 99, champions: CHAMPS, items })

  it('inimigos físicos → armadura (e a construção com armadura encaixa melhor)', () => {
    const s = run([player(5, 10, null), player(6, 11, null), player(7, 15, null)])
    expect(s.enemyDamage!.physical).toBeGreaterThan(0.7)
    expect(s.focus).toBe('armor')
    expect(s.picks.map((p) => p.itemId)).toEqual([2])
    expect(s.variantIndex).toBe(1)
  })

  it('inimigos mágicos → resistência mágica', () => {
    const s = run([player(5, 12, null), player(6, 13, null)])
    expect(s.focus).toBe('magic-resist')
    expect(s.picks.map((p) => p.itemId)).toEqual([3])
  })

  it('sem inimigos conhecidos não sugere nada', () => {
    const s = run([])
    expect(s).toMatchObject({ enemiesKnown: 0, enemyDamage: null, focus: null, picks: [], variantIndex: null })
  })

  it('dano equilibrado mantém a build padrão', () => {
    const s = run([player(5, 10, null), player(6, 12, null)])
    expect(s.focus).toBeNull()
    expect(s.variantIndex).toBeNull()
  })
})
