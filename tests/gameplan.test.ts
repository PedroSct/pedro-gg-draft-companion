import { describe, expect, it } from 'vitest'
import { buildGamePlan } from '../src/shared/gamePlan'
import type { ChampionBuild } from '../src/shared/dataTypes'

const levels = ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W', 'R', 'W', 'W'] as const
const build = (over: Partial<ChampionBuild> = {}): ChampionBuild => ({
  skillOrder: { priority: ['R', 'Q', 'E', 'W'], levels: [...levels] },
  items: { starting: [1055, 2003], boots: [3020], core: [6655, 3157, 3089, 3135], situational: [{ itemId: 3165, when: 'contra cura' }] },
  ...over
})

describe('plano de jogo', () => {
  it('divide a build em início, meio e fim', () => {
    const plan = buildGamePlan(build(), null, 'MIDDLE')!
    expect(plan.phases.map((p) => p.id)).toEqual(['early', 'mid', 'late'])
    const [early, mid, late] = plan.phases
    expect(early.items).toEqual([1055, 2003, 3020])
    expect(early.skills.map((s) => s.key).join('')).toBe('QWEQQ')
    expect(mid.items).toEqual([6655, 3157])
    expect(mid.skills.map((s) => s.level)).toEqual([6, 7, 8, 9, 10, 11])
    expect(mid.notes[0]).toMatch(/nível 6/)
    expect(late.items).toEqual([3089, 3135])
    expect(late.skills).toHaveLength(7)
    expect(late.situational).toEqual([{ itemId: 3165, when: 'contra cura' }])
    expect(plan.priority).toEqual(['Q', 'E', 'W'])
    expect(plan.ultLevels).toEqual([6, 11, 16])
    expect(plan.spells).toBeNull()
    expect(early.tips).toHaveLength(2)
    expect(late.tips).toHaveLength(2)
  })

  it('sem rota conhecida, não mostra dicas de rota', () => {
    const plan = buildGamePlan(build(), null, null)!
    expect(plan.phases.every((p) => p.tips.length === 0)).toBe(true)
  })

  it('sem ordem por nível, usa só a prioridade', () => {
    const plan = buildGamePlan(build({ skillOrder: { priority: ['R', 'Q', 'E', 'W'] } }))!
    expect(plan.phases[0].skills).toEqual([])
    expect(plan.phases[0].notes[0]).toMatch(/Q > E > W/)
    expect(plan.ultLevels).toEqual([])
  })

  it('a situação da partida troca a construção e acrescenta o foco de defesa', () => {
    const plan = buildGamePlan(build(), { enemiesKnown: 5, enemyDamage: { physical: 0.9, magic: 0.1 }, focus: 'armor', picks: [], variantCore: [1, 2, 3] } as never)!
    expect(plan.phases[1].items).toEqual([1, 2])
    expect(plan.phases[2].items).toEqual([3])
    expect(plan.phases[2].notes.join(' ')).toMatch(/armadura/)
  })

  it('sem dados, não inventa plano', () => {
    expect(buildGamePlan(null)).toBeNull()
    expect(buildGamePlan({ items: { starting: [], boots: [], core: [], situational: [] } })).toBeNull()
  })
})
