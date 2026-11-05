// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { finalize, newOpts, newState, type AggState } from '../tools/meta/aggregate'

function stateWith(opts: ReturnType<typeof newOpts>, core: Record<string, { count: number; posSum: number }> = {}): AggState {
  const st = newState('16.20')
  st.champions['103'] = {
    MIDDLE: {
      games: 200, wins: 100, matchups: {},
      build: { samples: 20, priority: {}, skillPrefix: {}, starting: {}, boots: {}, core, other: {}, opts }
    }
  }
  return st
}
const fin = (st: AggState) => finalize(st, { minGames: 1, minMatchupGames: 1, minBuildSamples: 1, source: 't', generatedAt: '2026-01-01' })

describe('builds: o mesmo conjunto em outra ordem é a mesma build', () => {
  it('soma as ordens e mostra a ordem de compra mais comum', () => {
    const opts = newOpts()
    opts.timeline = 40
    // A: 3 ordens diferentes dos mesmos itens (10+8+6 = 24); B: um conjunto único com 15 jogos
    opts.core = { '3001,3002,3003': { games: 10, wins: 6 }, '3003,3001,3002': { games: 8, wins: 4 }, '3002,3003,3001': { games: 6, wins: 3 }, '4001,4002,4003': { games: 15, wins: 8 } }
    const ds = fin(stateWith(opts, { '3003': { count: 10, posSum: 0 }, '3001': { count: 10, posSum: 10 }, '3002': { count: 10, posSum: 20 } }))
    const b = ds.champions['103'].roles.MIDDLE!.build!
    expect(b.options!.core![0]).toEqual({ value: [3003, 3001, 3002], games: 24, wins: 13 })
    expect(b.options!.core![1].value).toEqual([4001, 4002, 4003])
  })

  it('o padrão da build é a opção mais jogada, não uma mistura de itens', () => {
    const opts = newOpts()
    opts.timeline = 40
    opts.core = { '3001,3002,3003': { games: 12, wins: 7 }, '4001,4002,4003': { games: 5, wins: 2 } }
    opts.boots = { '3020': { games: 12, wins: 7 } }
    opts.starting = { '1056,2003': { games: 12, wins: 7 } }
    // vitórias contam outros itens mais vezes: não deve mandar no padrão
    const core = { '9001': { count: 30, posSum: 0 }, '9002': { count: 29, posSum: 29 }, '9003': { count: 28, posSum: 56 }, '3001': { count: 7, posSum: 0 } }
    const b = fin(stateWith(opts, core)).champions['103'].roles.MIDDLE!.build!
    expect(b.items.core).toEqual([3001, 3002, 3003])
    expect(b.items.boots[0]).toBe(3020)
    expect(b.items.starting).toEqual([1056, 2003])
  })
})
