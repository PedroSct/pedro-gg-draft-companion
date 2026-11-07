import { describe, expect, it } from 'vitest'
import { addHoldout, isHoldout, mergeStates, newState, type HoldoutMatch, type RawMatch } from '../tools/meta/aggregate'
import { formatBacktest, runBacktest } from '../tools/meta/backtest'
import type { MetaDataset } from '../src/shared/dataTypes'
import { ROLES } from '../src/shared/dataTypes'

// gerador pseudoaleatório com semente
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

function rawMatch(id: string, blue: number[], red: number[], blueWins: boolean, over: Record<string, unknown> = {}): RawMatch {
  const participants = [...blue, ...red].map((championId, i) => ({
    participantId: i + 1,
    teamId: i < 5 ? 100 : 200,
    teamPosition: POSITIONS[i % 5],
    championId,
    win: i < 5 ? blueWins : !blueWins
  }))
  return { metadata: { matchId: id }, info: { queueId: 420, gameDuration: 1500, gameVersion: '16.20.1', participants, ...over } } as unknown as RawMatch
}

describe('partidas reservadas para teste', () => {
  it('a escolha pelo id é fixa e pega cerca de 1 em cada 10', () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `BR1_${1000000 + i}`)
    const held = ids.filter(isHoldout)
    expect(ids.filter(isHoldout)).toEqual(held)
    expect(held.length).toBeGreaterThan(400)
    expect(held.length).toBeLessThan(600)
  })

  it('guarda campeões por rota e o time vencedor, sem mexer nas contagens', () => {
    const st = newState('16.20')
    expect(addHoldout(st, rawMatch('BR1_1', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], false))).toBe(true)
    expect(st.holdout).toEqual([{ w: 1, a: [1, 2, 3, 4, 5], b: [6, 7, 8, 9, 10] }])
    expect(st.matches).toBe(0)
    expect(Object.keys(st.champions)).toHaveLength(0)
  })

  it('ignora remake, outro patch, rota repetida e rota ausente', () => {
    const st = newState('16.20')
    expect(addHoldout(st, rawMatch('a', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true, { gameEndedInEarlySurrender: true }))).toBe(false)
    expect(addHoldout(st, rawMatch('b', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true, { gameVersion: '16.19.2' }))).toBe(false)
    const dup = rawMatch('c', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true)
    ;(dup.info!.participants as { teamPosition: string }[])[1].teamPosition = 'TOP'
    expect(addHoldout(st, dup)).toBe(false)
    const none = rawMatch('d', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true)
    ;(none.info!.participants as { teamPosition: string }[])[2].teamPosition = ''
    expect(addHoldout(st, none)).toBe(false)
    expect(st.holdout).toBeUndefined()
  })

  it('a junção de servidores soma as partidas reservadas', () => {
    const a = newState('16.20')
    const b = newState('16.20')
    addHoldout(a, rawMatch('1', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], true))
    addHoldout(b, rawMatch('2', [1, 2, 3, 4, 5], [6, 7, 8, 9, 10], false))
    expect(mergeStates([a, b]).merged.holdout).toHaveLength(2)
  })
})

describe('medição da recomendação', () => {
  // Campeões 1..10: o campeão i tem força real (i - 5.5)*1.2 pontos de winrate; o dataset conhece essa força.
  const strength = (id: number): number => (id - 5.5) * 0.012
  const dataset: MetaDataset = {
    schemaVersion: 1,
    source: 'teste',
    patch: '16.20',
    generatedAt: '2026-01-01T00:00:00Z',
    champions: Object.fromEntries(
      Array.from({ length: 10 }, (_, k) => {
        const id = k + 1
        const roles = Object.fromEntries(ROLES.map((r) => [r, { games: 2000, wins: Math.round(2000 * (0.5 + strength(id))), matchups: {} }]))
        return [String(id), { roles }]
      })
    )
  }

  function simulate(n: number, informative: boolean): HoldoutMatch[] {
    const rand = rng(7)
    const out: HoldoutMatch[] = []
    for (let i = 0; i < n; i++) {
      const pick = (): number[] => ROLES.map(() => 1 + Math.floor(rand() * 10))
      const a = pick()
      const b = pick()
      const diff = a.reduce((s, c) => s + strength(c), 0) - b.reduce((s, c) => s + strength(c), 0)
      const pBlue = informative ? 0.5 + diff : 0.5
      out.push({ w: rand() < pBlue ? 0 : 1, a, b })
    }
    return out
  }

  it('acha poder de previsão quando os dados explicam as vitórias', () => {
    const res = runBacktest(dataset, simulate(1500, true))
    const base = res[0]
    expect(base.total).toBeGreaterThan(1300)
    expect(base.accuracy).toBeGreaterThan(0.53) // o sinal simulado dá cerca de 54-56%
    expect(base.diff).toBe(0)
    // winrate + confronto (sem dados de confronto) = igual à referência
    const both = res.find((r) => r.name.startsWith('winrate + confronto'))!
    expect(both.accuracy).toBeCloseTo(base.accuracy, 2)
  })

  it('não acha poder nenhum quando as vitórias são sorteio puro', () => {
    const base = runBacktest(dataset, simulate(1500, false))[0]
    expect(base.accuracy).toBeGreaterThan(0.45)
    expect(base.accuracy).toBeLessThan(0.55)
  })

  it('o relatório traz o patch, a contagem e a acurácia de cada variação', () => {
    const text = formatBacktest(runBacktest(dataset, simulate(300, true)), 300, '16.20')
    expect(text).toMatch(/Patch 16\.20: 300 partidas/)
    expect(text).toMatch(/só winrate do campeão \(referência\)\s+acerta \d+\.\d%/)
    expect(text).toMatch(/modo Equilibrado/)
  })
})
