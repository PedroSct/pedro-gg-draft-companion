// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateDataset } from '../src/main/data/meta'
import { MIN_SYNERGY_GAMES, mainRole, pairRow, partnersOf, roleShare, synergyPairs } from '../src/main/data/synergies'

const base = { games: 20000, wins: 10000, matchups: {} }
const ds = validateDataset({
  schemaVersion: 1,
  source: 't',
  patch: '16.22',
  generatedAt: '',
  champions: {
    '10': {
      roles: {
        BOTTOM: {
          ...base,
          synergies: { '20': { games: 800, wins: 480 }, '21': { games: 40, wins: 32 }, '22': { games: 20, wins: 19 }, '23': { games: 600, wins: 400 }, '11': { games: 500, wins: 250 } }
        }
      }
    },
    '11': { roles: { BOTTOM: { ...base, synergies: { '20': { games: 300, wins: 150 }, '21': { games: 3000, wins: 1500 } } } } },
    '20': { roles: { UTILITY: { ...base, synergies: { '10': { games: 800, wins: 480 }, '11': { games: 300, wins: 150 } } } } },
    '21': { roles: { UTILITY: { ...base, synergies: { '10': { games: 40, wins: 32 }, '11': { games: 3000, wins: 1500 } } } } },
    '22': { roles: { UTILITY: { ...base } } },
    // flex: 70% topo, 30% suporte — o dado não diz em que rota ele estava no combo, então fica de fora do par com suporte
    '23': { roles: { TOP: { games: 14000, wins: 7000, matchups: {} }, UTILITY: { games: 6000, wins: 3000, matchups: {} } } }
  }
})

describe('sinergias entre rotas', () => {
  it('descobre a rota principal e a parte das partidas em cada rota', () => {
    expect(mainRole(ds, 23)).toMatchObject({ role: 'TOP' })
    expect(roleShare(ds, 23, 'UTILITY')).toBeCloseTo(0.3)
    expect(roleShare(ds, 99, 'UTILITY')).toBe(0)
  })

  it('lista só parceiros da rota pedida, com amostra mínima, e ordena pela nota conservadora', () => {
    const rows = synergyPairs(ds, 'BOTTOM', 'UTILITY')
    const ids = rows.map((r) => `${r.aId}-${r.bId}`)
    expect(ids).toContain('10-20')
    expect(ids).not.toContain('10-22') // 20 jogos: abaixo do mínimo
    expect(ids).not.toContain('10-23') // joga mais de topo que de suporte
    expect(ids).not.toContain('10-11') // dois atiradores
    expect(rows.every((r) => r.games >= MIN_SYNERGY_GAMES)).toBe(true)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score)
  })

  it('poucos jogos encolhem a nota: 80% em 40 jogos fica atrás de 60% em 800 e não passa de B', () => {
    const rows = synergyPairs(ds, 'BOTTOM', 'UTILITY')
    const small = rows.find((r) => r.bId === 21 && r.aId === 10)!
    const big = rows.find((r) => r.bId === 20 && r.aId === 10)!
    expect(small.rare).toBe(true)
    expect(big.rare).toBe(false)
    expect(small.score).toBeLessThan(big.score)
    expect(['A', 'S']).not.toContain(small.tier)
    expect(big.winrate).toBeCloseTo(0.6)
  })

  it('a sinergia mede o que a dupla rende além dos dois sozinhos', () => {
    const rows = synergyPairs(ds, 'BOTTOM', 'UTILITY')
    const good = rows.find((r) => r.aId === 10 && r.bId === 20)!
    const flat = rows.find((r) => r.aId === 11 && r.bId === 21)!
    expect(good.synergy).toBeGreaterThan(5) // 60% com dois campeões de 50%
    expect(Math.abs(flat.synergy)).toBeLessThan(0.5) // 50% = soma dos dois
  })

  it('fixando um campeão, lista só os parceiros dele; vale pelos dois lados do par', () => {
    const fromA = synergyPairs(ds, 'BOTTOM', 'UTILITY', { anchor: 10, anchorRole: 'BOTTOM' })
    expect(fromA.every((r) => r.aId === 10)).toBe(true)
    const fromB = synergyPairs(ds, 'BOTTOM', 'UTILITY', { anchor: 20, anchorRole: 'UTILITY' })
    expect(fromB.map((r) => [r.aId, r.bId])).toEqual(
      expect.arrayContaining([
        [10, 20],
        [11, 20]
      ])
    )
    expect(fromB.every((r) => r.bId === 20)).toBe(true)
  })

  it('rotas iguais ou inválidas e campeão sem dados devolvem lista vazia', () => {
    expect(synergyPairs(ds, 'BOTTOM', 'BOTTOM')).toEqual([])
    expect(synergyPairs(ds, 'BOTTOM', 'UTILITY', { anchor: 999 })).toEqual([])
    expect(partnersOf(ds, 22, 'UTILITY', 'BOTTOM', false)).toEqual([])
  })

  it('respeita o limite', () => {
    expect(synergyPairs(ds, 'BOTTOM', 'UTILITY', { limit: 1 })).toHaveLength(1)
  })
})

describe('meta com as duas rotas gravadas (pairs)', () => {
  const g = (games: number, rate: number) => ({ games, wins: Math.round(games * rate) })
  const pds = validateDataset({
    schemaVersion: 1, source: 't', patch: '16.22', generatedAt: '',
    champions: {
      '10': { roles: { BOTTOM: { ...base, synergies: { '20': g(500, 0.6), '31': g(500, 0.6) }, pairs: { 'UTILITY:20': g(300, 0.62), 'MIDDLE:31': g(200, 0.6) } } } },
      // campeão 20 joga mais na selva, mas aqui a dupla foi gravada como suporte: vale a rota gravada
      '20': { roles: { JUNGLE: { ...base, games: 30000, wins: 15000 }, UTILITY: { ...base, games: 8000, wins: 4000, pairs: { 'BOTTOM:10': g(300, 0.62) } } } },
      '31': { roles: { MIDDLE: { ...base } } }
    }
  })
  it('usa a rota gravada em vez de adivinhar pela rota principal do parceiro', () => {
    const rows = partnersOf(pds, 10, 'BOTTOM', 'UTILITY', true)
    expect(rows.map((r) => r.bId)).toEqual([20])
    expect(rows[0].games).toBe(300)
    expect(partnersOf(pds, 10, 'BOTTOM', 'MIDDLE', true).map((r) => r.bId)).toEqual([31])
  })
  it('a dupla de um draft vem das rotas gravadas', () => {
    expect(pairRow(pds, 10, 'BOTTOM', 20, 'UTILITY')?.games).toBe(300)
  })
})
