import { describe, expect, it } from 'vitest'
import { summarizeProgress } from '../src/shared/progress'
import type { PgSummary } from '../src/shared/postgame'

let n = 0
const g = (over: Partial<PgSummary> = {}): PgSummary => ({
  gameId: ++n, playedAt: 1_000_000 + n * 1000, savedAt: 0, durationSec: 1800, mode: 'CLASSIC', queueId: 420,
  win: true, championId: 1, role: 'MIDDLE', score: 60, grade: 'B', kills: 5, deaths: 3, assists: 6, hasTimeline: true, ...over
})

describe('summarizeProgress', () => {
  it('lista vazia não quebra', () => {
    const p = summarizeProgress([])
    expect(p.games).toBe(0)
    expect(p.winrate).toBeNull()
    expect(p.observations).toEqual([])
  })
  it('conta vitórias, ordena a tendência por data e mede a mudança de nota', () => {
    const list = [...Array.from({ length: 5 }, () => g({ score: 50 })), ...Array.from({ length: 5 }, () => g({ score: 70 }))]
    const p = summarizeProgress([...list].reverse())
    expect(p.winrate).toBe(1)
    expect(p.trend[0].score).toBe(50)
    expect(p.trend.at(-1)!.score).toBe(70)
    expect(p.scoreChange).toBe(20)
    expect(p.observations.some((o) => o.title === 'Você está evoluindo')).toBe(true)
  })
  it('detecta mais mortes nas derrotas e agrupa por campeão', () => {
    const list = [
      ...Array.from({ length: 3 }, () => g({ win: false, deaths: 9, championId: 2, score: 40 })),
      ...Array.from({ length: 3 }, () => g({ win: true, deaths: 3, championId: 1, score: 75 }))
    ]
    const p = summarizeProgress(list)
    expect(p.observations.map((o) => o.title)).toContain('As derrotas vêm com mais mortes')
    expect(p.champions.map((c) => c.championId).sort()).toEqual([1, 2])
    expect(p.champions.find((c) => c.championId === 2)!.winrate).toBe(0)
  })
  it('com poucas partidas não inventa padrões', () => {
    expect(summarizeProgress([g(), g(), g()]).observations).toEqual([])
  })
})
