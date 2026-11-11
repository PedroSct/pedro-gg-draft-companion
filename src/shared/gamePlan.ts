// Plano de jogo: a build do campeão reorganizada em início, meio e fim da partida.
// Só usa o que já está nos dados de meta (ordem de habilidades, itens iniciais, botas, itens principais e situacionais);
// não inventa dicas. É leitura: o app não joga nem decide nada pela pessoa.
import type { BuildSituation, ChampionBuild, SituationalItem, SkillKey } from './dataTypes'

export interface PlanSkill {
  level: number
  key: SkillKey
}

export interface PlanPhase {
  id: 'early' | 'mid' | 'late'
  title: string
  /** faixa de níveis de campeão a que a fase se refere */
  levels: string
  /** habilidades a evoluir nesta fase (vazio se os dados não trazem a ordem por nível) */
  skills: PlanSkill[]
  /** itens a comprar nesta fase, na ordem */
  items: number[]
  /** itens situacionais (fase final) */
  situational: SituationalItem[]
  /** frases curtas tiradas dos dados */
  notes: string[]
}

export interface GamePlan {
  phases: PlanPhase[]
  /** prioridade de habilidade sem a ultimate, ex.: ['Q','E','W'] */
  priority: SkillKey[]
  /** níveis em que a ultimate é evoluída (vazio se não há ordem por nível) */
  ultLevels: number[]
}

const SPLIT = { early: 5, mid: 11 } as const // fim do nível 5 e do nível 11

function skillsBetween(levels: SkillKey[] | undefined, from: number, to: number): PlanSkill[] {
  if (!levels) return []
  const out: PlanSkill[] = []
  for (let lv = from; lv <= to && lv <= levels.length; lv++) out.push({ level: lv, key: levels[lv - 1] })
  return out
}

/** Monta o plano; devolve null quando a build não tem nada para mostrar. */
export function buildGamePlan(build: ChampionBuild | null | undefined, situation?: BuildSituation | null): GamePlan | null {
  if (!build) return null
  const levels = build.skillOrder?.levels
  const priority = (build.skillOrder?.priority ?? []).filter((k) => k !== 'R')
  const core = situation?.variantCore && situation.variantCore.length > 0 ? situation.variantCore : build.items.core
  const ultLevels = levels ? levels.map((k, i) => (k === 'R' ? i + 1 : 0)).filter((n) => n > 0) : []

  const early: PlanPhase = {
    id: 'early',
    title: 'Início',
    levels: 'níveis 1 a 5',
    skills: skillsBetween(levels, 1, SPLIT.early),
    items: [...build.items.starting, ...build.items.boots],
    situational: [],
    notes: []
  }
  if (!levels && priority.length > 0) early.notes.push(`Evolua ${priority.join(' > ')} (prioridade).`)
  if (levels && priority.length > 0) early.notes.push(`Máximo primeiro: ${priority[0]}.`)

  const mid: PlanPhase = {
    id: 'mid',
    title: 'Meio',
    levels: 'níveis 6 a 11',
    skills: skillsBetween(levels, SPLIT.early + 1, SPLIT.mid),
    items: core.slice(0, 2),
    situational: [],
    notes: []
  }
  if (ultLevels.length > 0) mid.notes.push(`Ultimate disponível no nível ${ultLevels[0]}.`)

  const late: PlanPhase = {
    id: 'late',
    title: 'Fim',
    levels: 'níveis 12 a 18',
    skills: skillsBetween(levels, SPLIT.mid + 1, 18),
    items: core.slice(2),
    situational: build.items.situational.slice(0, 4),
    notes: []
  }
  if (situation?.focus === 'armor') late.notes.push('O inimigo causa quase só dano físico: priorize armadura.')
  if (situation?.focus === 'magic-resist') late.notes.push('O inimigo causa quase só dano mágico: priorize resistência mágica.')
  if (situation?.focus === 'penetration') late.notes.push('O inimigo tem vários tanques: priorize penetração.')

  const empty = (p: PlanPhase): boolean => p.skills.length === 0 && p.items.length === 0 && p.situational.length === 0 && p.notes.length === 0
  const phases = [early, mid, late].filter((p) => !empty(p))
  if (phases.length === 0) return null
  return { phases, priority, ultLevels }
}
