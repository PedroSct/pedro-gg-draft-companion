// src/shared/poolShare.ts
// Tipos e regras puras de compartilhamento de Pool (a codificação em si fica no main, que tem zlib).
import type { Role } from './types'
import { ROLES, type Pool, type PoolEntry } from './dataTypes'

/** O que viaja entre amigos: a Pool e um pouco de identificação, nunca ids internos do app. */
export interface SharedProfile {
  nickname: string
  riotId?: string
  mainRoles: Role[]
  notes?: string
  pool: Pool
}

export interface ShareOptions {
  /** Inclui as anotações (do perfil e de cada campeão). Padrão: não. */
  includeNotes: boolean
}

export type DecodeResult = { ok: true; shared: SharedProfile } | { ok: false; message: string }

/** Como aplicar uma Pool recebida ao que já existe. */
export type ImportMode = 'new' | 'merge' | 'replace'

export const emptyPool = (): Pool => ({ TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] })

export const poolSize = (pool: Pool): number => ROLES.reduce((n, r) => n + pool[r].length, 0)

/**
 * merge   : mantém tudo o que você já tem (inclusive seu nível de conforto) e acrescenta só o que faltava.
 * replace : a Pool recebida substitui a sua inteira.
 */
export function mergePools(base: Pool, incoming: Pool, mode: 'merge' | 'replace'): Pool {
  if (mode === 'replace') return structuredClone(incoming)
  const out = structuredClone(base)
  for (const role of ROLES) {
    const have = new Set(out[role].map((e) => e.championId))
    for (const e of incoming[role]) {
      if (!have.has(e.championId)) {
        out[role].push({ ...e })
        have.add(e.championId)
      }
    }
  }
  return out
}

/** Quantos campeões da Pool recebida ainda não existem na Pool de destino (por rota). */
export function countNew(base: Pool, incoming: Pool): number {
  let n = 0
  for (const role of ROLES) {
    const have = new Set(base[role].map((e) => e.championId))
    n += incoming[role].filter((e: PoolEntry) => !have.has(e.championId)).length
  }
  return n
}
