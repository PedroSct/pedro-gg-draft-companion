import { describe, expect, it } from 'vitest'
import { analyzeCoach } from '../src/shared/coach'
import type { ChampionInfo, MetaTierRow } from '../src/shared/dataTypes'
import type { AccountGame } from '../src/shared/poolImport'

const champ = (id: number, name: string, tags: string[], attack: number, magic: number, difficulty: number): ChampionInfo => ({
  id,
  key: name,
  name,
  iconUrl: '',
  tags,
  info: { attack, defense: 4, magic, difficulty }
})
const CH = [
  champ(17, 'Teemo', ['Marksman', 'Assassin'], 5, 7, 6),
  champ(1, 'Annie', ['Mage'], 2, 10, 6),
  champ(2, 'Garen', ['Fighter', 'Tank'], 7, 1, 5),
  champ(3, 'Darius', ['Fighter', 'Tank'], 9, 1, 3),
  champ(4, 'Singed', ['Tank', 'Mage'], 4, 7, 5),
  champ(5, 'Vayne', ['Marksman', 'Assassin'], 10, 1, 8),
  champ(6, 'Ornn', ['Tank', 'Fighter'], 5, 6, 5),
  champ(7, 'Sett', ['Fighter', 'Tank'], 8, 1, 2)
]
const nameOf = (id: number): string => CH.find((c) => c.id === id)?.name ?? `#${id}`
const row = (championId: number, delta: number, winrate = 0.51, over: Partial<MetaTierRow> = {}): MetaTierRow => ({
  championId, games: 5000, winrate, delta, score: delta, presence: 0.05, tier: delta >= 2 ? 'S' : 'B', hasBuild: true, lowSample: false, ...over
})
const games = (id: number, role: AccountGame['role'], n: number, wins: number): AccountGame[] =>
  Array.from({ length: n }, (_, i) => ({ championId: id, role, win: i < wins }))

const TOP_ROWS = [row(2, 1), row(3, 2.5, 0.54), row(7, 2, 0.53), row(4, 1.5), row(6, 1.2), row(5, 3), row(1, 0.5), row(17, 0.2)]

describe('aba Treino', () => {
  it('detecta o one-trick, avisa e sugere campeões parecidos, sem repetir o que ele já joga', () => {
    const report = analyzeCoach({
      games: [...games(17, 'TOP', 14, 5), ...games(2, 'TOP', 2, 1)],
      mastery: [{ championId: 17, points: 90_000, level: 7 }],
      champions: CH,
      tiers: { TOP: TOP_ROWS },
      nameOf
    })
    expect(report.gamesUsed).toBe(16)
    expect(report.oneTrick?.championId).toBe(17)
    expect(report.concentration).toBe('high')
    expect(report.mainRole).toBe('TOP')
    expect(report.tips.some((t) => t.level === 'warn' && /Teemo/.test(t.title) && /88%/.test(t.title))).toBe(true)
    expect(report.tips.some((t) => /vence só 36%/.test(t.title) || /36%/.test(t.title))).toBe(true) // 5/14 de vitórias
    expect(report.suggestions.length).toBeGreaterThan(0)
    expect(report.suggestions.every((s) => s.championId !== 17)).toBe(true)
    expect(report.suggestions.every((s) => s.role === 'TOP')).toBe(true)
    for (const s of report.suggestions) expect(s.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('quem já joga lutador recebe lutadores, e no máximo 2 da mesma classe principal', () => {
    const report = analyzeCoach({
      games: [...games(2, 'TOP', 8, 4), ...games(3, 'TOP', 6, 3), ...games(7, 'TOP', 4, 2), ...games(1, 'TOP', 3, 1)],
      mastery: [],
      champions: CH,
      tiers: { TOP: [...TOP_ROWS, row(8, 2, 0.52)] },
      nameOf
    })
    const fighters = report.suggestions.filter((s) => CH.find((c) => c.id === s.championId)?.tags[0] === 'Fighter')
    expect(fighters.length).toBeLessThanOrEqual(2)
    expect(report.oneTrick).toBeNull()
    expect(report.concentration).not.toBe('high')
  })

  it('pessoa nova: poucas partidas viram aviso e as sugestões preferem campeões fáceis', () => {
    const report = analyzeCoach({
      games: games(1, 'TOP', 5, 2),
      mastery: [],
      champions: CH,
      tiers: { TOP: [row(5, 1.5), row(3, 1.5), row(7, 1.5), row(6, 1.5)] },
      nameOf
    })
    expect(report.level).toBe('new')
    expect(report.tips[0].title).toMatch(/5 partidas analisadas/)
    const order = report.suggestions.map((s) => s.championId)
    expect(order.indexOf(7)).toBeLessThan(order.indexOf(5)) // Sett (dificuldade 2) antes de Vayne (8)
  })

  it('lembra campeões com maestria alta que não aparecem nas partidas recentes', () => {
    const report = analyzeCoach({
      games: games(2, 'TOP', 12, 6),
      mastery: [{ championId: 4, points: 120_000, level: 7 }],
      champions: CH,
      tiers: { TOP: TOP_ROWS },
      nameOf
    })
    expect(report.tips.some((t) => t.championId === 4 && /Singed/.test(t.title) && /120 mil/.test(t.detail))).toBe(true)
  })

  it('sem partidas: não quebra e explica', () => {
    const report = analyzeCoach({ games: [], mastery: [], champions: CH, tiers: {}, nameOf })
    expect(report.gamesUsed).toBe(0)
    expect(report.suggestions).toEqual([])
    expect(report.mainRole).toBeNull()
    expect(report.tips[0].title).toMatch(/Sem partidas/)
  })

  it('sem dados reais do meta (amostra), não sugere nada', () => {
    const report = analyzeCoach({ games: games(2, 'TOP', 12, 6), mastery: [], champions: CH, tiers: {}, nameOf })
    expect(report.suggestions).toEqual([])
  })
})
