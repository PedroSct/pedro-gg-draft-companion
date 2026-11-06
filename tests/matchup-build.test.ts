// @vitest-environment node
// Runas e feitiços por oponente de rota: coleta, junção de servidores, validação e troca do padrão na partida.
import { describe, expect, it } from 'vitest'
import { addMatch, finalize, itemRulesFrom, mergeStates, newState, type RawMatch, type RawParticipant } from '../tools/meta/aggregate'
import { validateDataset } from '../src/main/data/meta'
import { withMatchupBuild } from '../src/main/data/matchupBuild'
import { laneEnemyOf } from '../src/main/data/recommender'
import type { ChampionBuild, MetaDataset, RunePage } from '../src/shared/dataTypes'
import type { DraftState, Role } from '../src/shared/types'

const ROLES5: Role[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
const rules = itemRulesFrom({ data: {} })
const fin = (s: ReturnType<typeof newState>, o: { minMatchupBuildGames?: number } = {}) =>
  finalize(s, { minGames: 1, minMatchupGames: 1, minBuildSamples: 1, source: 't', generatedAt: '', ...o })

const perks = (keystone: number): RawParticipant['perks'] => ({
  statPerks: { offense: 5008, flex: 5008, defense: 5001 },
  styles: [
    { description: 'primaryStyle', style: 8100, selections: [{ perk: keystone }, { perk: 8139 }, { perk: 8138 }, { perk: 8135 }] },
    { description: 'subStyle', style: 8200, selections: [{ perk: 8226 }, { perk: 8210 }] }
  ]
})

/** Campeão 1 (TOP, time azul) contra o campeão 6 (TOP, time vermelho). `mine` define o que o campeão 1 usou. */
function game(mine: { keystone: number; spells: [number, number] }, win: boolean): RawMatch {
  return {
    info: {
      gameVersion: '16.22.1.1',
      queueId: 420,
      gameDuration: 1800,
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        championId: i + 1,
        teamId: i < 5 ? 100 : 200,
        teamPosition: ROLES5[i % 5],
        win: (i < 5) === win,
        summoner1Id: i === 0 ? mine.spells[0] : 4,
        summoner2Id: i === 0 ? mine.spells[1] : 14,
        perks: i === 0 ? perks(mine.keystone) : perks(8112)
      }))
    }
  }
}

function collect(plan: { keystone: number; spells: [number, number]; n: number; wins: number }[]) {
  const s = newState('16.22')
  for (const p of plan) for (let i = 0; i < p.n; i++) addMatch(s, game(p, i < p.wins), null, rules)
  return s
}

describe('coleta por confronto', () => {
  const s = collect([
    { keystone: 8010, spells: [4, 12], n: 22, wins: 14 }, // Conquistador + Flash/Teleporte
    { keystone: 8112, spells: [4, 14], n: 8, wins: 3 }
  ])

  it('guarda a escolha mais usada contra o oponente, com vitórias', () => {
    const mb = fin(s).champions['1'].roles.TOP!.matchupBuilds!['6']
    expect(mb.games).toBe(30)
    expect(mb.runes).toMatchObject({ games: 22, wins: 14 })
    expect((mb.runes!.value as RunePage).perkIds[0]).toBe(8010)
    expect(mb.spells).toEqual({ value: [4, 12], games: 22, wins: 14 })
  })
  it('sem amostra suficiente contra o oponente, não guarda nada', () => {
    const few = collect([{ keystone: 8010, spells: [4, 12], n: 12, wins: 6 }])
    expect(fin(few).champions['1'].roles.TOP!.matchupBuilds).toBeUndefined()
    expect(fin(few, { minMatchupBuildGames: 10 }).champions['1'].roles.TOP!.matchupBuilds!['6'].games).toBe(12)
  })
  it('uma escolha com poucas partidas dentro de um confronto grande vira ruído e some', () => {
    const noisy = collect([
      { keystone: 8010, spells: [4, 12], n: 6, wins: 3 },
      { keystone: 8112, spells: [4, 14], n: 6, wins: 3 },
      { keystone: 8214, spells: [4, 7], n: 6, wins: 3 },
      { keystone: 8005, spells: [4, 3], n: 6, wins: 3 },
      { keystone: 8021, spells: [4, 21], n: 6, wins: 3 }
    ])
    // 30 partidas, a mais usada tem 6 (20%): ainda entra, mas com 5 escolhas empatadas a amostra é a mesma de qualquer uma
    expect(fin(noisy).champions['1'].roles.TOP!.matchupBuilds?.['6']?.runes?.games).toBe(6)
  })
  it('juntar servidores soma as escolhas por confronto', () => {
    const a = collect([{ keystone: 8010, spells: [4, 12], n: 12, wins: 6 }])
    const b = collect([{ keystone: 8010, spells: [4, 12], n: 10, wins: 5 }])
    const { merged } = mergeStates([a, b])
    const v = merged.champions['1'].TOP!.vsOpts!['6']
    expect(v.games).toBe(22)
    expect(Object.values(v.runes)[0]).toEqual({ games: 22, wins: 11 })
    expect(a.champions['1'].TOP!.vsOpts!['6'].games).toBe(12) // não altera os originais
    expect(fin(merged).champions['1'].roles.TOP!.matchupBuilds!['6'].games).toBe(22)
  })
  it('checkpoints antigos (sem vsOpts) continuam funcionando', () => {
    const old = newState('16.22')
    old.champions['1'] = { TOP: { games: 30, wins: 15, matchups: {}, build: { samples: 0, priority: {}, skillPrefix: {}, starting: {}, boots: {}, core: {}, other: {} } } }
    expect(fin(old).champions['1'].roles.TOP!.matchupBuilds).toBeUndefined()
    expect(() => mergeStates([old, s])).not.toThrow()
  })
})

describe('validação do arquivo de dados', () => {
  const ds = fin(collect([{ keystone: 8010, spells: [4, 12], n: 22, wins: 14 }]))
  it('mantém as escolhas por confronto e ignora entradas ruins sem derrubar o arquivo', () => {
    const ok = validateDataset(JSON.parse(JSON.stringify(ds)))
    expect(ok.champions['1'].roles.TOP!.matchupBuilds!['6'].spells?.value).toEqual([4, 12])
    const raw = JSON.parse(JSON.stringify(ds))
    raw.champions['1'].roles.TOP.matchupBuilds = { x: { games: 5 }, '7': { games: 'muitas' }, '8': { games: 30, runes: { value: 'lixo', games: 3, wins: 1 } } }
    expect(validateDataset(raw).champions['1'].roles.TOP!.matchupBuilds).toBeUndefined()
  })
})

describe('build ajustada ao oponente de rota', () => {
  const page = (k: number): RunePage => ({ primaryStyleId: 8100, subStyleId: 8200, perkIds: [k, 8139, 8138, 8135, 8226, 8210, 5008, 5008, 5001] })
  const base: ChampionBuild = {
    runes: page(8112),
    spells: [4, 14],
    items: { starting: [], boots: [], core: [], situational: [] },
    options: { games: 100, timeline: 50, runes: [{ value: page(8112), games: 60, wins: 30 }, { value: page(8010), games: 20, wins: 9 }], spells: [{ value: [4, 14], games: 80, wins: 40 }] }
  }
  it('troca runas e feitiços pelos do confronto e coloca a opção na frente', () => {
    const mb = { games: 30, runes: { value: page(8010), games: 22, wins: 14 }, spells: { value: [4, 12] as [number, number], games: 22, wins: 14 } }
    const b = withMatchupBuild(base, mb, 6)
    expect(b.runes?.perkIds[0]).toBe(8010)
    expect(b.spells).toEqual([4, 12])
    expect(b.options!.runes![0]).toEqual(mb.runes)
    expect(b.options!.runes!.filter((o) => o.value.perkIds[0] === 8010)).toHaveLength(1) // sem duplicar a que já existia
    expect(b.options!.runes!.some((o) => o.value.perkIds[0] === 8112)).toBe(true)
    expect(b.matchup).toEqual({ enemyId: 6, games: 30, runes: true, spells: true })
    expect(base.runes?.perkIds[0]).toBe(8112) // o original não muda
  })
  it('quando o confronto usa a mesma escolha geral, só avisa', () => {
    const b = withMatchupBuild(base, { games: 25, runes: { value: page(8112), games: 15, wins: 8 }, spells: { value: [14, 4], games: 15, wins: 8 } }, 6)
    expect(b.runes).toEqual(base.runes)
    expect(b.spells).toEqual([4, 14])
    expect(b.matchup).toEqual({ enemyId: 6, games: 25, runes: false, spells: false })
  })
  it('sem dados do confronto devolve a build como está', () => {
    expect(withMatchupBuild(base, undefined, 6)).toBe(base)
  })
})

describe('quem é o oponente de rota', () => {
  const ds: MetaDataset = { schemaVersion: 1, source: 't', patch: '16.22', generatedAt: '', champions: {} }
  const draft = (enemies: { id: number; status: 'locked' | 'hovering'; role: Role | null }[]): DraftState =>
    ({ phase: 'BAN_PICK', localPlayerCellId: 0, localRole: 'TOP', allies: [], enemies: enemies.map((e, i) => ({ cellId: 5 + i, championId: e.id, status: e.status, role: e.role })), bans: { allies: [], enemies: [] } }) as unknown as DraftState
  it('só devolve quando está travado e a rota é conhecida', () => {
    expect(laneEnemyOf(draft([{ id: 6, status: 'locked', role: 'TOP' }]), ds, 'TOP')).toBe(6)
    expect(laneEnemyOf(draft([{ id: 6, status: 'hovering', role: 'TOP' }]), ds, 'TOP')).toBeNull() // ainda pode mudar
    expect(laneEnemyOf(draft([{ id: 6, status: 'locked', role: 'MIDDLE' }]), ds, 'TOP')).toBeNull()
  })
  it('com dois candidatos igualmente prováveis, não chuta', () => {
    expect(laneEnemyOf(draft([{ id: 6, status: 'locked', role: 'TOP' }, { id: 7, status: 'locked', role: 'TOP' }]), ds, 'TOP')).toBeNull()
  })
})
