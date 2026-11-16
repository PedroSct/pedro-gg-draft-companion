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

describe('pontuação por área (geral)', () => {
  const areas = (farm: number, vision: number, extra: Partial<PgSummary> = {}) =>
    g({ areas: [{ key: 'farm', score: farm }, { key: 'vision', score: vision }, { key: 'survival', score: 80 }], csPerMin: 6, visionPerMin: 0.5, killParticipation: 0.6, ...extra })

  it('sem notas por área ou com menos de 3 partidas não mostra nada', () => {
    expect(summarizeProgress([g(), g(), g()]).areas).toEqual([])
    expect(summarizeProgress([areas(50, 50), areas(50, 50)]).areas).toEqual([])
  })

  it('média por área, conceito, nível e foco nas duas mais fracas', () => {
    const p = summarizeProgress(Array.from({ length: 4 }, () => areas(30, 50)))
    const by = Object.fromEntries(p.areas.map((a) => [a.key, a]))
    expect(by.farm).toMatchObject({ avg: 30, level: 'weak', focus: true, games: 4 })
    expect(by.vision).toMatchObject({ avg: 50, level: 'ok', focus: true })
    expect(by.survival).toMatchObject({ avg: 80, level: 'strong', focus: false })
    expect(by.farm.detail).toContain('6.0 CS')
  })

  it('mede a tendência (5 últimas x 5 anteriores) e só usa as últimas 20', () => {
    const old = Array.from({ length: 5 }, () => areas(40, 50))
    const recent = Array.from({ length: 5 }, () => areas(70, 50))
    expect(summarizeProgress([...old, ...recent]).areas.find((a) => a.key === 'farm')!.change).toBe(30)
    const many = [...Array.from({ length: 10 }, () => areas(0, 50)), ...Array.from({ length: 20 }, () => areas(80, 50))]
    expect(summarizeProgress(many).areas.find((a) => a.key === 'farm')!.avg).toBe(80)
  })

  it('uma área ausente em várias partidas (sem timeline) usa só as que a têm', () => {
    const noLaning = (i: number) => g({ areas: [{ key: 'farm', score: 60 }, ...(i < 2 ? [{ key: 'laning' as const, score: 90 }] : [])] })
    const p = summarizeProgress(Array.from({ length: 5 }, (_, i) => noLaning(i)))
    expect(p.areas.find((a) => a.key === 'laning')).toBeUndefined() // só 2 partidas
    expect(p.areas.find((a) => a.key === 'farm')!.games).toBe(5)
  })
})

