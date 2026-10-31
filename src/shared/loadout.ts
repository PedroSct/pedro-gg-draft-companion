// src/shared/loadout.ts
// Tipos do "Importar para o cliente" (runas, feitiços e itens da partida).
export interface LoadoutParts {
  runes: boolean
  spells: boolean
  items: boolean
}
export interface PartResult {
  ok: boolean
  message: string
}
export type LoadoutResult = Partial<Record<keyof LoadoutParts, PartResult>>
