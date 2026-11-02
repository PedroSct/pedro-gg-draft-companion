// @vitest-environment node
// 0.5.2: opções de build (todas as partidas), habilidades fora do padrão, região dos dados, sugestões de ban.
import { describe, expect, it } from 'vitest'
import { addMatch, finalize, isValidSkillSequence, itemRulesFrom, mergeStates, newState, type RawMatch } from '../tools/meta/aggregate'
import { validateDataset } from '../src/main/data/meta'
import { banPhaseOpen, suggestBans } from '../src/main/data/bans'
import { sanitizeSettingsPatch } from '../src/main/store/profiles'
import { applyBuildSelection, sanitizeSelection } from '../src/shared/buildSelection'
import { regionUrl, DEFAULT_META_URL } from '../src/shared/config'
import { emptyPool } from '../src/shared/poolShare'
import type { FriendProfile, MetaDataset, RoleMeta } from '../src/shared/dataTypes'
import type { DraftPlayer, DraftState, Role } from '../src/shared/types'

const ROLES5: Role[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const rules = itemRulesFrom({ data: { '3089': { gold: { total: 3600, purchasable: true }, tags: [], from: ['1026'], maps: { '11': true } } } })
const PERKS = {
  statPerks: { offense: 5008, flex: 5008, defense: 5001 },
  styles: [
    { description: 'primaryStyle', style: 8100, selections: [8112, 8139, 8138, 8135].map((perk) => ({ perk })) },
    { description: 'subStyle', style: 8200, selections: [8226, 8210].map((perk) => ({ perk })) }
  ]
}

function game(blueWins: boolean): RawMatch {
  return {
    info: {
      gameVersion: '16.21.1.1',
      queueId: 420,
      gameDuration: 1800,
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        championId: i + 1,
        teamId: i < 5 ? 100 : 200,
        teamPosition: ROLES5[i % 5],
        win: (i < 5) === blueWins,
        summoner1Id: 4,
        summoner2Id: 14,
        perks: PERKS
      }))
    }
  }
}
const skillTimeline = (seq: string) => ({
  info: {
    frames: [
      {
        events: [...seq].map((k, j) => ({
          type: 'SKILL_LEVEL_UP',
          participantId: 1,
          skillSlot: 'QWER'.indexOf(k) + 1,
          levelUpType: 'NORMAL',
          timestamp: 1000 * (j + 1)
        }))
      }
    ]
  }
})
const opts = { minGames: 1, minMatchupGames: 1, minBuildSamples: 1, source: 't', generatedAt: '' }

describe('coleta 0.5.2', () => {
  it('as opções contam vitórias e derrotas (pick% e winrate de cada runa/feitiço)', () => {
    const s = newState('16.21')
    for (let n = 0; n < 6; n++) addMatch(s, game(n < 2), skillTimeline('QWEQQRQEQEREEWWRWW'), rules)
    const ds = validateDataset(JSON.parse(JSON.stringify(finalize(s, opts))))
    const o = ds.champions['1'].roles.TOP!.build!.options!
    expect(o.runes![0]).toMatchObject({ games: 6, wins: 2 })
    expect(o.spells![0]).toMatchObject({ value: [4, 14], games: 6, wins: 2 })
    expect(o.skills![0]).toMatchObject({ games: 6, wins: 2 })
  })

  it('campeão com sequência de habilidades fora do padrão (ex.: Aphelios) ainda ganha build', () => {
    const odd = 'QWQWQWQWQWEEEERRRR'
    expect(isValidSkillSequence(odd)).toBe(false)
    const s = newState('16.21')
    for (let n = 0; n < 4; n++) addMatch(s, game(true), skillTimeline(odd), rules)
    const ds = validateDataset(JSON.parse(JSON.stringify(finalize(s, opts))))
    const b = ds.champions['1'].roles.TOP!.build!
    expect(b).toBeDefined()
    expect(b.runes).toBeDefined()
    expect(b.spells).toEqual([4, 14])
    expect(b.options!.skills![0].games).toBe(4)
  })

  it('sem nenhuma habilidade válida a build ainda traz runas e feitiços', () => {
    const s = newState('16.21')
    for (let n = 0; n < 3; n++) addMatch(s, game(true), null, rules)
    const b = validateDataset(JSON.parse(JSON.stringify(finalize(s, opts)))).champions['1'].roles.TOP!.build!
    expect(b.runes).toBeDefined()
    expect(b.spells).toEqual([4, 14])
    expect(b.skillOrder).toBeUndefined()
  })

  it('juntar servidores soma as opções de build', () => {
    const a = newState('16.21')
    const b = newState('16.21')
    for (let n = 0; n < 3; n++) addMatch(a, game(true), skillTimeline('QWEQQRQEQEREEWWRWW'), rules)
    for (let n = 0; n < 4; n++) addMatch(b, game(false), skillTimeline('QWEQQRQEQEREEWWRWW'), rules)
    const { merged } = mergeStates([a, b])
    const ds = validateDataset(JSON.parse(JSON.stringify(finalize(merged, { ...opts, regions: ['br1', 'kr'] }))))
    const o = ds.champions['1'].roles.TOP!.build!.options!
    expect(o.runes![0]).toMatchObject({ games: 7, wins: 3 })
    expect(o.timeline).toBe(7)
    expect(ds.regions).toEqual(['br1', 'kr'])
  })
})

describe('região dos dados', () => {
  it('troca meta.json por meta-<região>.json só quando faz sentido', () => {
    expect(regionUrl(DEFAULT_META_URL, 'global')).toBe(DEFAULT_META_URL)
    expect(regionUrl(DEFAULT_META_URL, 'br1')).toBe(DEFAULT_META_URL.replace('/meta.json', '/meta-br1.json'))
    expect(regionUrl('https://exemplo.com/dados.json', 'br1')).toBe('https://exemplo.com/dados.json')
    expect(regionUrl(DEFAULT_META_URL, '../x')).toBe(DEFAULT_META_URL)
  })

  it('a configuração só aceita global ou um código curto', () => {
    expect(sanitizeSettingsPatch({ metaRegion: 'euw1' })).toEqual({ metaRegion: 'euw1' })
    expect(sanitizeSettingsPatch({ metaRegion: 'global' })).toEqual({ metaRegion: 'global' })
    expect(() => sanitizeSettingsPatch({ metaRegion: '../etc' })).toThrow()
    expect(() => sanitizeSettingsPatch({ metaRegion: 3 })).toThrow()
  })
})

// ------------------------------------------------------------------------ banimentos

const rm = (games: number, wins: number, matchups: RoleMeta['matchups'] = {}): RoleMeta => ({ games, wins, matchups })

/** 20 = counter forte do campeão 10 no mid; 21 = counter fraco; 22 = forte no meta; 23 = quase nunca joga mid. */
const DS: MetaDataset = {
  schemaVersion: 1,
  source: 'real',
  patch: '16.21',
  generatedAt: '',
  champions: {
    '10': { roles: { MIDDLE: rm(1000, 500) } },
    '20': { roles: { MIDDLE: rm(1000, 500, { '10': { games: 60, wins: 42 } }) } },
    '21': { roles: { MIDDLE: rm(1000, 500, { '10': { games: 60, wins: 33 } }) } },
    '22': { roles: { MIDDLE: rm(2000, 1140) } },
    '23': { roles: { MIDDLE: rm(10, 5, { '10': { games: 10, wins: 9 } }), UTILITY: rm(990, 500) } }
  }
}

function mid(comfort: number): FriendProfile {
  const pool = emptyPool()
  pool.MIDDLE = [{ championId: 10, championKey: 'C10', comfort }]
  return { id: 'p1', nickname: 'Pedro', mainRoles: ['MIDDLE'], pool } as unknown as FriendProfile
}
const pl = (cellId: number, championId: number, role: Role | null, extra: Partial<DraftPlayer> = {}): DraftPlayer =>
  ({ cellId, championId, role, status: 'none', ...extra }) as DraftPlayer
const draft = (over: Partial<DraftState> = {}): DraftState =>
  ({
    phase: 'BAN_PICK',
    localPlayerCellId: 0,
    localRole: 'MIDDLE',
    allies: [pl(0, 0, 'MIDDLE', { isMe: true, profileId: 'p1' })],
    enemies: [],
    bans: { allies: [], enemies: [] },
    ...over
  }) as DraftState

describe('sugestões de banimento', () => {
  it('sugere quem mais atrapalha o seu campeão de conforto alto e quem está forte no meta', () => {
    const r = suggestBans({ draft: draft(), dataset: DS, profiles: [mid(5)] })
    const ids = r.map((x) => x.championId)
    expect(ids[0]).toBe(20) // vence 70% do confronto contra o seu campeão
    expect(ids).toContain(22) // forte no meta
    expect(ids).not.toContain(23) // joga pouco no mid: ruído
    const top = r.find((x) => x.championId === 20)!
    expect(top.reasons[0]).toMatchObject({ kind: 'counter', championId: 10, nickname: 'Pedro', games: 60 })
  })

  it('conforto baixo não gasta ban e confronto equilibrado não entra', () => {
    const r = suggestBans({ draft: draft(), dataset: DS, profiles: [mid(3)] })
    expect(r.every((x) => x.reasons.every((y) => y.kind === 'meta'))).toBe(true)
    expect(r.map((x) => x.championId)).not.toContain(21)
  })

  it('não sugere quem já foi banido ou escolhido', () => {
    const r = suggestBans({ draft: draft({ bans: { allies: [20], enemies: [] }, enemies: [pl(5, 22, null, { status: 'locked' })] }), dataset: DS, profiles: [mid(5)] })
    expect(r.map((x) => x.championId)).not.toContain(20)
    expect(r.map((x) => x.championId)).not.toContain(22)
  })

  it('usa o perfil ativo quando o app ainda não reconheceu você', () => {
    const d = draft({ allies: [pl(0, 0, 'MIDDLE', { isMe: true })] })
    expect(suggestBans({ draft: d, dataset: DS, profiles: [mid(5)] }).some((x) => x.reasons.some((y) => y.kind === 'counter'))).toBe(false)
    expect(suggestBans({ draft: d, dataset: DS, profiles: [mid(5)], fallbackProfileId: 'p1' })[0].championId).toBe(20)
  })

  it('amigo reconhecido também protege o campeão dele', () => {
    const friend: FriendProfile = { ...mid(5), id: 'p2', nickname: 'Amigo' }
    const d = draft({ allies: [pl(0, 0, 'TOP'), pl(1, 0, 'MIDDLE', { profileId: 'p2' })] })
    const r = suggestBans({ draft: d, dataset: DS, profiles: [friend] })
    expect(r[0].reasons[0]).toMatchObject({ kind: 'counter', nickname: 'Amigo' })
  })

  it('sem dados reais não sugere nada', () => {
    expect(suggestBans({ draft: draft(), dataset: null, profiles: [mid(5)] })).toEqual([])
    expect(suggestBans({ draft: draft(), dataset: { ...DS, isSample: true }, profiles: [mid(5)] })).toEqual([])
  })

  it('só aparece enquanto os bans estão abertos', () => {
    expect(banPhaseOpen(draft({ phase: 'PLANNING' }))).toBe(true)
    expect(banPhaseOpen(draft())).toBe(true)
    expect(banPhaseOpen(draft({ bans: { allies: [1, 2, 3, 4, 5], enemies: [6, 7, 8, 9, 10] } }))).toBe(false)
    expect(banPhaseOpen(draft({ allies: [pl(0, 5, 'MIDDLE', { status: 'locked' })] }))).toBe(false)
    expect(banPhaseOpen(draft({ phase: 'FINALIZATION' }))).toBe(false)
  })
})

describe('opção escolhida para enviar ao LoL', () => {
  const page = (n: number) => ({ primaryStyleId: 8100, subStyleId: 8200, perkIds: [n, 1, 2, 3, 4, 5, 6, 7, 8] })
  const build = {
    runes: page(1),
    spells: [4, 14] as [number, number],
    items: { starting: [1055], boots: [3020], core: [3089, 3157, 6653], situational: [] },
    options: {
      games: 100,
      timeline: 80,
      runes: [{ value: page(1), games: 60, wins: 30 }, { value: page(2), games: 40, wins: 22 }],
      spells: [{ value: [4, 14] as [number, number], games: 70, wins: 35 }, { value: [4, 12] as [number, number], games: 30, wins: 16 }],
      starting: [{ value: [1055], games: 50, wins: 25 }, { value: [1056, 2003], games: 30, wins: 15 }],
      boots: [{ value: 3020, games: 50, wins: 25 }, { value: 3158, games: 30, wins: 14 }],
      core: [{ value: [3089, 3157, 6653], games: 40, wins: 20 }, { value: [6653, 3089, 3157], games: 30, wins: 18 }]
    }
  }

  it('troca runas, feitiços, inicial, botas e principais pelas opções escolhidas', () => {
    const b = applyBuildSelection(build, { runes: 1, spells: 1, starting: 1, boots: 1, core: 1 })
    expect(b.runes!.perkIds[0]).toBe(2)
    expect(b.spells).toEqual([4, 12])
    expect(b.items.starting).toEqual([1056, 2003])
    expect(b.items.boots).toEqual([3158])
    expect(b.items.core).toEqual([6653, 3089, 3157])
  })

  it('índice fora da lista cai na opção mais usada e build sem opções fica como está', () => {
    expect(applyBuildSelection(build, { runes: 9, spells: 0, starting: 0, boots: 0, core: 0 }).runes!.perkIds[0]).toBe(1)
    const legacy = { runes: page(1), spells: [4, 14] as [number, number], items: { starting: [], boots: [], core: [3089], situational: [] } }
    expect(applyBuildSelection(legacy, { runes: 1, spells: 1, starting: 1, boots: 1, core: 1 })).toBe(legacy)
  })

  it('o main só aceita índices inteiros pequenos vindos da tela', () => {
    expect(sanitizeSelection({ runes: 1, core: -1, boots: 2.5, spells: '1', starting: 99, x: 3 })).toEqual({ runes: 1, spells: 0, starting: 0, boots: 0, core: 0 })
    expect(sanitizeSelection(null)).toEqual({ runes: 0, spells: 0, starting: 0, boots: 0, core: 0 })
  })
})
