// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { championDetail, gradeOf, rolePresence, tierOf, tierRows, tierScore } from '../src/main/data/metaStats'
import { validateDataset } from '../src/main/data/meta'

const ds = validateDataset({
  schemaVersion: 1,
  source: 't',
  patch: '16.20',
  generatedAt: '',
  champions: {
    '1': { roles: { MIDDLE: { games: 10000, wins: 5600, matchups: { '2': { games: 500, wins: 300 }, '3': { games: 400, wins: 150 }, '9': { games: 3, wins: 3 } }, synergies: { '4': { games: 800, wins: 520 } } } } },
    '2': { roles: { MIDDLE: { games: 6000, wins: 2900, matchups: {} } } },
    '3': { roles: { MIDDLE: { games: 30, wins: 25, matchups: {} } } }, // poucos jogos: não pode virar S
    '4': { roles: { TOP: { games: 100, wins: 50, matchups: {} } } }
  }
})

describe('tela Meta: estatísticas', () => {
  it('classifica em tiers pelo winrate suavizado', () => {
    expect([tierOf(3), tierOf(1), tierOf(0), tierOf(-1), tierOf(-3)]).toEqual(['S', 'A', 'B', 'C', 'D'])
  })

  it('o tier compara jogos com vitórias: poucos jogos encolhem a nota, muitos jogos a mantêm', () => {
    const few = { games: 150, wins: 87 } // 58%
    const many = { games: 15000, wins: 7950 } // 53%
    expect(tierScore(few)).toBeLessThan(tierScore(many))
    expect(gradeOf(few, 0.02).tier).not.toBe('S')
    expect(gradeOf(many, 0.03).tier).toBe('S')
    // vale também para baixo: poucos jogos não condenam o campeão
    expect(Math.abs(tierScore({ games: 150, wins: 63 }))).toBeLessThan(Math.abs(tierScore({ games: 15000, wins: 7050 })))
  })

  it('campeão pouco jogado não passa de B, e S pede presença na rota', () => {
    const niche = { games: 1400, wins: 769 } // 54,9% em 0,23% das partidas
    const g = gradeOf(niche, 0.0023)
    expect(g.rare).toBe(true)
    expect(g.tier).toBe('B')
    const strongButUncommon = gradeOf({ games: 15000, wins: 7950 }, 0.01) // abaixo de 1,5%
    expect(strongButUncommon.rare).toBe(false)
    expect(strongButUncommon.tier).toBe('A')
    expect(gradeOf({ games: 20000, wins: 9400 }, 0.05).tier).toBe('D') // 47% com muitos jogos
    expect(gradeOf({ games: 20000, wins: 9400 }, 0.001).tier).toBe('B') // nicho nunca é C nem D
  })

  it('rolePresence é a fração das partidas da rota', () => {
    expect(rolePresence(ds, 1, 'MIDDLE')).toBeCloseTo(10000 / 16030, 3)
    expect(rolePresence(ds, 1, 'TOP')).toBe(0)
  })

  it('ranking da rota: amostra pequena não ganha de quem tem muitos jogos', () => {
    const rows = tierRows(ds, 'MIDDLE')
    expect(rows.map((r) => r.championId)).toEqual([1, 3, 2])
    expect(rows.find((r) => r.championId === 3)!.tier).not.toBe('S')
    expect(rows[0].tier).toBe('S')
    expect(rows[0].presence).toBeCloseTo(10000 / 16030, 3)
    expect(tierRows(ds, 'TOP')).toHaveLength(1)
    expect(tierRows(ds, 'UTILITY')).toEqual([])
  })

  it('detalhe: melhores e piores confrontos (ignora poucos jogos) e aliados', () => {
    const d = championDetail(ds, 1, 'MIDDLE')!
    expect(d.best.map((m) => m.championId)).toEqual([2])
    expect(d.worst.map((m) => m.championId)).toEqual([3])
    expect(d.allies[0].championId).toBe(4)
    expect(d.best.some((m) => m.championId === 9)).toBe(false) // só 3 jogos
    expect(championDetail(ds, 1, 'TOP')).toBeNull()
  })

  it('usa o dado espelhado quando só o oponente tem o confronto', () => {
    const d = championDetail(ds, 2, 'MIDDLE')!
    // o campeão 1 tem 300/500 contra o 2, então o 2 vai pior contra o 1
    expect(d.worst.map((m) => m.championId)).toContain(1)
  })
})

describe('taxa de ban e o tier', () => {
  const ds = validateDataset({
    schemaVersion: 1, source: 't', patch: '16.22', generatedAt: '',
    bans: { matches: 1000, counts: { '1': 300, '3': 10 } },
    champions: {
      '1': { roles: { MIDDLE: { games: 400, wins: 240, matchups: {} } } }, // 0,4% da rota, mas banido em 30%
      '2': { roles: { MIDDLE: { games: 99600, wins: 49800, matchups: {} } } },
      '3': { roles: { MIDDLE: { games: 100, wins: 50, matchups: {} }, TOP: { games: 400, wins: 200, matchups: {} } } }
    }
  })
  it('campeão muito banido deixa de contar como de nicho', () => {
    const rows = tierRows(ds, 'MIDDLE')
    const a = rows.find((r) => r.championId === 1)!
    expect(a.banRate).toBeCloseTo(0.3)
    expect(a.rare).toBe(false)
    expect(gradeOf({ games: 400, wins: 240 }, 0.004).rare).toBe(true)
    expect(gradeOf({ games: 400, wins: 240 }, 0.004, 0.3).rare).toBe(false)
  })
  it('o ban só vale para a rota principal do campeão', () => {
    expect(tierRows(ds, 'MIDDLE').find((r) => r.championId === 3)!.banRate).toBeUndefined() // 20% das partidas dele no meio
    expect(tierRows(ds, 'TOP').find((r) => r.championId === 3)!.banRate).toBeCloseTo(0.01)
  })
  it('meta sem bans não tem taxa', () => {
    expect(tierRows(validateDataset({ ...JSON.parse(JSON.stringify(ds)), bans: undefined }), 'MIDDLE')[0].banRate).toBeUndefined()
  })
})
