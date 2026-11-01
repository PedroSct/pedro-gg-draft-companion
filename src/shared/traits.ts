// src/shared/traits.ts
// Como cada campeão "joga" na composição: tipo de dano, tanque e controle de grupo (CC).
// Vem do perfil real do meta.json (médias de partidas); sem ele, estima pelas notas e classes do Data Dragon.
import type { Role } from './types'
import { ROLES, type ChampionInfo, type MetaDataset } from './dataTypes'

export interface Traits {
  /** fatias do dano causado; somam 1 */
  physical: number
  magic: number
  true: number
  /** 0..1 */
  durability: number
  /** 0..1 */
  cc: number
  source: 'data' | 'estimate'
}

const NEUTRAL: Traits = { physical: 0.5, magic: 0.5, true: 0, durability: 0.4, cc: 0.3, source: 'estimate' }

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
/** dano sofrido + mitigado por minuto: ~800 (frágil) a ~3200 (tanque) */
const normDurability = (perMinute: number): number => clamp01((perMinute - 800) / 2400)
/** segundos de CC por minuto: ~2,5 já é muito */
const normCc = (perMinute: number): number => clamp01(perMinute / 2.5)

/** Estimativa quando não há dados reais do campeão. */
export function estimateTraits(c: ChampionInfo | undefined): Traits {
  if (!c) return NEUTRAL
  const tags = c.tags
  const attack = c.info?.attack ?? 5
  const magic = c.info?.magic ?? 5
  const sum = attack + magic
  const physical = sum > 0 ? attack / sum : 0.5
  const tank = tags.includes('Tank') ? 1 : 0
  const defense = c.info ? c.info.defense / 10 : tank ? 0.8 : 0.4
  const durability = clamp01(tank ? Math.max(0.7, defense) : defense * 0.8)
  const cc = tank || tags.includes('Support') ? 0.6 : tags.includes('Mage') ? 0.35 : 0.2
  return { physical, magic: 1 - physical, true: 0, durability, cc, source: 'estimate' }
}

/**
 * Traços do campeão. Com `role`, usa o perfil daquela rota; sem rota, faz a média ponderada pelos jogos
 * das rotas que ele joga (a LCU não informa a rota dos inimigos).
 */
export function traitsOf(
  dataset: MetaDataset | null,
  champions: ReadonlyMap<number, ChampionInfo> | null,
  championId: number,
  role: Role | null
): Traits {
  const roles = dataset?.champions[String(championId)]?.roles
  if (roles) {
    const rows = (role ? [role] : [...ROLES])
      .map((r) => roles[r])
      .filter((m): m is NonNullable<typeof m> => !!m && !!m.profile)
    if (rows.length) {
      const total = rows.reduce((s, m) => s + m.games, 0) || 1
      const acc = { physical: 0, magic: 0, true: 0, durability: 0, cc: 0 }
      for (const m of rows) {
        const w = m.games / total
        const p = m.profile!
        acc.physical += p.physical * w
        acc.magic += p.magic * w
        acc.true += p.true * w
        acc.durability += p.durability * w
        acc.cc += p.cc * w
      }
      return { physical: acc.physical, magic: acc.magic, true: acc.true, durability: normDurability(acc.durability), cc: normCc(acc.cc), source: 'data' }
    }
  }
  return estimateTraits(champions?.get(championId))
}
