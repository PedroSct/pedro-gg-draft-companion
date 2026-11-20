// src/shared/buildSelection.ts
// Qual opção de cada parte da build a pessoa escolheu na tela (0 = a mais usada). O renderer só manda os números;
// quem monta a build a importar é o main, a partir do meta.
import type { ChampionBuild } from './dataTypes'

export interface BuildSelection {
  runes: number
  spells: number
  starting: number
  boots: number
  core: number
  /** ordem das habilidades (opção da lista de habilidades) */
  skills: number
}

export const ZERO_SELECTION: BuildSelection = { runes: 0, spells: 0, starting: 0, boots: 0, core: 0, skills: 0 }

const KEYS = Object.keys(ZERO_SELECTION) as (keyof BuildSelection)[]

export function sanitizeSelection(raw: unknown): BuildSelection {
  const out = { ...ZERO_SELECTION }
  if (typeof raw !== 'object' || raw === null) return out
  for (const k of KEYS) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 20) out[k] = v
  }
  return out
}

function pick<T>(list: T[] | undefined, index: number): T | undefined {
  if (!list || list.length === 0) return undefined
  return list[index] ?? list[0]
}

/** A build com as opções escolhidas no lugar das padrão (sem `options`, devolve a própria build). */
export function applyBuildSelection(build: ChampionBuild, sel: BuildSelection): ChampionBuild {
  const o = build.options
  if (!o) return build
  const runes = pick(o.runes, sel.runes)?.value ?? build.runes
  const spells = pick(o.spells, sel.spells)?.value ?? build.spells
  const starting = pick(o.starting, sel.starting)?.value ?? build.items.starting
  const boot = pick(o.boots, sel.boots)?.value
  const core = pick(o.core, sel.core)?.value ?? build.items.core
  const skills = pick(o.skills, sel.skills)?.value
  // A build completa continua valendo: os itens tardios que não entraram nos principais escolhidos seguem depois deles
  const late = (build.items.full ?? []).filter((id) => !build.items.core.includes(id) && !core.includes(id))
  const full = build.items.full ? [...core, ...late].slice(0, 6) : undefined
  return { ...build, runes, spells, ...(skills ? { skillOrder: skills } : {}), items: { ...build.items, starting, boots: boot !== undefined ? [boot] : build.items.boots, core, ...(full ? { full } : {}) } }
}
