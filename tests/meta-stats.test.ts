// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { championDetail, tierOf, tierRows } from '../src/main/data/metaStats'
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
    expect([tierOf(3), tierOf(1), tierOf(0), tierOf(-1.5), tierOf(-3)]).toEqual(['S', 'A', 'B', 'C', 'D'])
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
