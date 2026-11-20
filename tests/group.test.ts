// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateDataset } from '../src/main/data/meta'
import { analyzeGroup, groupLabel } from '../src/main/data/group'

const g = (games: number, rate: number) => ({ games, wins: Math.round(games * rate) })
const base = (games = 20000) => ({ games, wins: games / 2, matchups: {} })
const ds = validateDataset({
  schemaVersion: 1,
  source: 't',
  patch: '16.22',
  generatedAt: '',
  champions: {
    // atirador 10 e meio 30 (do grupo)
    '10': { roles: { BOTTOM: { ...base(), synergies: { '20': g(800, 0.6), '21': g(900, 0.46), '30': g(500, 0.57) } } } },
    '30': { roles: { MIDDLE: { ...base(), synergies: { '10': g(500, 0.57), '20': g(400, 0.5) } } } },
    // suportes candidatos
    '20': { roles: { UTILITY: { ...base(), synergies: { '10': g(800, 0.6), '30': g(400, 0.5) } } } },
    '21': { roles: { UTILITY: { ...base(), synergies: { '10': g(900, 0.46), '30': g(300, 0.52) } } } },
    '22': { roles: { UTILITY: { ...base(), synergies: { '10': g(20, 0.9) } } } }, // 20 jogos: pouco
    '23': { roles: { UTILITY: { ...base(60), synergies: { '10': g(50, 0.7) } } } }, // 60 jogos: fora das sugestões
    '24': { roles: { UTILITY: { ...base(), synergies: { '10': g(700, 0.58) } } } } // só tem dado com um do grupo
  }
})

const me = { cellId: 1, role: 'BOTTOM' as const, championId: 10 }
const mid = { cellId: 2, role: 'MIDDLE' as const, championId: 30 }
const open = { cellId: 3, role: 'UTILITY' as const, championId: 0 }

describe('modo Grupo', () => {
  it('monta o par de quem já escolheu, com as rotas do draft', () => {
    const a = analyzeGroup(ds, [me, mid, open])
    expect(a.pairs).toHaveLength(1)
    expect(a.pairs[0]).toMatchObject({ aId: 10, bId: 30, aRole: 'BOTTOM', bRole: 'MIDDLE' })
    expect(a.pairs[0].row?.winrate).toBeCloseTo(0.57)
    expect(a.best).toEqual({ aId: 10, bId: 30 })
  })

  it('time fechado: todos os pares entre os escolhidos (n·(n−1)/2) e nota média do grupo', () => {
    const sup = { cellId: 3, role: 'UTILITY' as const, championId: 20 }
    const a = analyzeGroup(ds, [me, mid, sup])
    expect(a.pairs).toHaveLength(3)
    expect(a.score).not.toBeNull()
    expect(['forte', 'boa', 'neutra', 'fraca']).toContain(a.label)
    // ordenado do melhor para o pior combo
    for (let i = 1; i < a.pairs.length; i++) expect(a.pairs[i - 1].row?.score ?? -99).toBeGreaterThanOrEqual(a.pairs[i].row?.score ?? -99)
  })

  it('par sem dados suficientes aparece com row nulo e não entra na nota', () => {
    const lonely = { cellId: 4, role: 'TOP' as const, championId: 99 }
    const a = analyzeGroup(ds, [me, lonely])
    expect(a.pairs).toHaveLength(1)
    expect(a.pairs[0].row).toBeNull()
    expect(a.score).toBeNull()
    expect(a.label).toBeNull()
  })

  it('sugere para a vaga aberta pelo conjunto do grupo, sem poucos jogos e sem campeões indisponíveis', () => {
    const a = analyzeGroup(ds, [me, mid, open], [24])
    const picks = a.suggestions[0].picks.map((p) => p.championId)
    expect(a.suggestions[0]).toMatchObject({ cellId: 3, role: 'UTILITY' })
    expect(picks[0]).toBe(20) // 60% com o atirador e 50% com o meio
    expect(picks).not.toContain(24) // banido/escolhido por outro
    expect(picks).not.toContain(23) // campeão de poucos jogos na rota
    expect(picks.indexOf(20)).toBeLessThan(picks.indexOf(21)) // 21 perde para o atirador
  })

  it('quem tem dado com todo o grupo passa na frente de quem só tem com um', () => {
    const a = analyzeGroup(ds, [me, mid, open])
    const picks = a.suggestions[0].picks
    const p20 = picks.find((p) => p.championId === 20)!
    const p24 = picks.find((p) => p.championId === 24)!
    expect(p20.covered).toBe(2)
    expect(p24.covered).toBe(1)
    expect(p24.total).toBe(2)
    expect(p20.score).toBeGreaterThan(p24.score)
  })

  it('sem ninguém escolhido não há sugestão; membros repetidos contam uma vez', () => {
    expect(analyzeGroup(ds, [open]).suggestions).toEqual([])
    expect(analyzeGroup(ds, [me, me, mid]).pairs).toHaveLength(1)
  })

  it('classifica a nota do grupo', () => {
    expect([groupLabel(2), groupLabel(0.5), groupLabel(0), groupLabel(-1)]).toEqual(['forte', 'boa', 'neutra', 'fraca'])
  })
})
