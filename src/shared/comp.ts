// src/shared/comp.ts
// Leitura rápida da composição de um time: equilíbrio entre dano físico e mágico e presença de frontline.
// Usa só dados oficiais do Data Dragon (classes e notas de ataque/defesa/magia), então vale para qualquer patch.
import type { ChampionInfo } from './dataTypes'

export type CompWarning = 'no-frontline' | 'mostly-ad' | 'mostly-ap'

export interface CompAnalysis {
  picks: number
  /** fração do dano que tende a ser físico / mágico (somam 1) */
  ad: number
  ap: number
  frontline: number
  warnings: CompWarning[]
}

/** A partir de quantos campeões os avisos fazem sentido (com menos, o time ainda está montando). */
const MIN_PICKS_FOR_WARNING = 3
const LOPSIDED = 0.75
const FRONTLINE_DEFENSE = 7

function damageSplit(c: ChampionInfo): { ad: number; ap: number; weight: number } {
  const attack = c.info?.attack
  const magic = c.info?.magic
  if (attack !== undefined && magic !== undefined && attack + magic > 0) {
    return { ad: attack / (attack + magic), ap: magic / (attack + magic), weight: Math.max(2, attack + magic) }
  }
  // Sem notas (cache antigo): estima pela classe.
  if (c.tags.includes('Mage')) return { ad: 0.15, ap: 0.85, weight: 8 }
  if (c.tags.includes('Marksman') || c.tags.includes('Assassin') || c.tags.includes('Fighter')) return { ad: 0.85, ap: 0.15, weight: 8 }
  return { ad: 0.5, ap: 0.5, weight: 3 }
}

export function analyzeComp(champions: readonly ChampionInfo[]): CompAnalysis | null {
  if (champions.length === 0) return null
  let ad = 0
  let ap = 0
  let total = 0
  let frontline = 0
  for (const c of champions) {
    const d = damageSplit(c)
    ad += d.ad * d.weight
    ap += d.ap * d.weight
    total += d.weight
    if (c.tags.includes('Tank') || (c.info?.defense ?? 0) >= FRONTLINE_DEFENSE) frontline++
  }
  const warnings: CompWarning[] = []
  if (champions.length >= MIN_PICKS_FOR_WARNING) {
    if (frontline === 0) warnings.push('no-frontline')
    if (ad / total >= LOPSIDED) warnings.push('mostly-ad')
    if (ap / total >= LOPSIDED) warnings.push('mostly-ap')
  }
  return { picks: champions.length, ad: ad / total, ap: ap / total, frontline, warnings }
}
