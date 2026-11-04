// src/main/data/patchChanges.ts
// O que mudou de um patch para o outro nos campeões das suas Pools: tier, winrate e primeiro item da build.
// Funções puras; o main guarda o último "retrato" visto (meta-seen.json).
import { ROLES, type FriendProfile, type MetaDataset, type PatchChange, type PatchChanges, type Tier } from '../../shared/dataTypes'
import type { Role } from '../../shared/types'
import { tierRows } from './metaStats'

export interface SnapshotRow {
  tier: Tier
  /** 0..1 */
  winrate: number
  games: number
  /** primeiro item do núcleo da build (null = sem build) */
  core: number | null
}

export interface MetaSnapshot {
  patch: string
  /** servidores do dataset: trocar de região não conta como "mudança de patch" */
  regions: string
  rows: Record<string, SnapshotRow>
}

const MIN_GAMES = 100
const WINRATE_STEP = 0.015
const MAX_CHANGES = 12
const TIER_ORDER: Tier[] = ['D', 'C', 'B', 'A', 'S']

export const keyOf = (championId: number, role: Role): string => `${championId}|${role}`

export function snapshotOf(ds: MetaDataset): MetaSnapshot {
  const rows: Record<string, SnapshotRow> = {}
  for (const role of ROLES) {
    for (const r of tierRows(ds, role)) {
      rows[keyOf(r.championId, role)] = {
        tier: r.tier,
        winrate: r.winrate,
        games: r.games,
        core: ds.champions[String(r.championId)]?.roles[role]?.build?.items.core[0] ?? null
      }
    }
  }
  return { patch: ds.patch, regions: (ds.regions ?? []).join(','), rows }
}

/** Todos os campeões que alguma Pool usa, por rota (quem passa `only` olha só um perfil). */
function poolKeys(profiles: readonly FriendProfile[]): Set<string> {
  const keys = new Set<string>()
  for (const p of profiles) for (const role of ROLES) for (const e of p.pool[role] ?? []) keys.add(keyOf(e.championId, role))
  return keys
}

export function diffSnapshots(prev: MetaSnapshot, cur: MetaSnapshot, profiles: readonly FriendProfile[]): PatchChange[] {
  const out: PatchChange[] = []
  for (const k of poolKeys(profiles)) {
    const a = prev.rows[k]
    const b = cur.rows[k]
    if (!a || !b || a.games < MIN_GAMES || b.games < MIN_GAMES) continue
    const [id, role] = k.split('|')
    const tierMove = TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier)
    const winrateMove = b.winrate - a.winrate
    const coreChanged = a.core !== null && b.core !== null && a.core !== b.core
    if (tierMove === 0 && Math.abs(winrateMove) < WINRATE_STEP && !coreChanged) continue
    out.push({
      championId: Number(id),
      role: role as Role,
      fromTier: a.tier,
      toTier: b.tier,
      winrateFrom: a.winrate,
      winrateTo: b.winrate,
      ...(coreChanged ? { coreFrom: a.core as number, coreTo: b.core as number } : {})
    })
  }
  const weight = (c: PatchChange): number =>
    Math.abs(TIER_ORDER.indexOf(c.toTier) - TIER_ORDER.indexOf(c.fromTier)) * 10 + Math.abs(c.winrateTo - c.winrateFrom) * 100 + (c.coreFrom !== undefined ? 1 : 0)
  return out.sort((x, y) => weight(y) - weight(x) || x.championId - y.championId).slice(0, MAX_CHANGES)
}

/**
 * Decide o que mostrar. `null` = nada a avisar (primeira vez, mesmo patch, outra região ou nada mudou).
 * `ack` diz se o retrato atual já pode ser guardado sem avisar.
 */
export function patchNotice(
  seen: MetaSnapshot | null,
  ds: MetaDataset | null,
  profiles: readonly FriendProfile[]
): { notice: PatchChanges | null; ack: boolean } {
  if (!ds || ds.isSample) return { notice: null, ack: false }
  const cur = snapshotOf(ds)
  if (!seen || seen.regions !== cur.regions || seen.patch === cur.patch) return { notice: null, ack: !seen || seen.regions !== cur.regions }
  const changes = diffSnapshots(seen, cur, profiles)
  if (changes.length === 0) return { notice: null, ack: true }
  return { notice: { fromPatch: seen.patch, toPatch: cur.patch, changes }, ack: false }
}
