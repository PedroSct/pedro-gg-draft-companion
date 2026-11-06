// src/main/store/profiles.ts
// Persistência local de perfis, Champion Pools e configurações (profiles.json).
// Tudo que vem do renderer é tratado como entrada não confiável e sanitizado.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Role } from '../../shared/types'
import {
  ROLES,
  type AppSettings,
  type FriendProfile,
  type Pool,
  type PoolEntry,
  type ProfilesFile
} from '../../shared/dataTypes'
import type { SharedProfile } from '../../shared/poolShare'
import { writeJsonAtomic } from './fsJson'

const DEFAULT_SETTINGS: AppSettings = {
  lockfilePath: null,
  ddragonVersion: 'auto',
  locale: 'pt_BR',
  lastActiveProfileId: null,
  metaUrl: null,
  metaAutoUpdate: true,
  metaRegion: 'global',
  pickMode: 'balanced',
  autoAccept: false,
  autoAcceptDelay: 1,
  tourDone: false,
  introAnimation: true,
  reduceMotion: false,
  overlayEnabled: false,
  overlayCorner: 'tr',
  overlayOpacity: 0.9,
  overlayCompact: false,
  overlayPos: null
}

function isHttpsUrl(v: string): boolean {
  try {
    return new URL(v).protocol === 'https:'
  } catch {
    return false
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' ? v.trim().slice(0, max) || undefined : undefined

const emptyPool = (): Pool => ({ TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] })

export function sanitizePool(raw: unknown): Pool {
  const pool = emptyPool()
  if (!isRecord(raw)) return pool
  for (const role of ROLES) {
    const list = raw[role]
    if (!Array.isArray(list)) continue
    const seen = new Set<number>()
    for (const item of list) {
      if (!isRecord(item)) continue
      const id = item.championId
      const key = item.championKey
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || seen.has(id)) continue
      if (typeof key !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(key)) continue
      seen.add(id)
      const comfort =
        typeof item.comfort === 'number' && Number.isFinite(item.comfort)
          ? Math.min(5, Math.max(1, Math.round(item.comfort)))
          : 3
      const entry: PoolEntry = { championId: id, championKey: key, comfort }
      const notes = str(item.notes, 500)
      if (notes) entry.notes = notes
      pool[role].push(entry)
    }
  }
  return pool
}

/** Perfil recebido de um amigo (código ou arquivo): só os campos que viajam, tudo validado. */
export function sanitizeShared(raw: unknown): SharedProfile {
  if (!isRecord(raw)) throw new Error('Pool inválida')
  const mainRoles = Array.isArray(raw.mainRoles)
    ? [...new Set(raw.mainRoles.filter((r): r is Role => ROLES.includes(r as Role)))]
    : []
  const shared: SharedProfile = {
    nickname: str(raw.nickname, 40) ?? 'Amigo',
    mainRoles,
    pool: sanitizePool(raw.pool)
  }
  const riotId = str(raw.riotId, 40)
  if (riotId) shared.riotId = riotId
  const notes = str(raw.notes, 2000)
  if (notes) shared.notes = notes
  return shared
}

export function sanitizeProfile(
  raw: unknown,
  existing?: Pick<FriendProfile, 'id' | 'createdAt'>
): FriendProfile {
  if (!isRecord(raw)) throw new Error('Perfil inválido')
  const nickname = str(raw.nickname, 40)
  if (!nickname) throw new Error('O perfil precisa de um apelido')

  const now = new Date().toISOString()
  const mainRoles = Array.isArray(raw.mainRoles)
    ? [...new Set(raw.mainRoles.filter((r): r is Role => ROLES.includes(r as Role)))]
    : []

  return {
    id: existing?.id ?? `p_${randomUUID().slice(0, 8)}`,
    nickname,
    riotId: str(raw.riotId, 40),
    puuid: typeof raw.puuid === 'string' && /^[\w-]{8,100}$/.test(raw.puuid) ? raw.puuid : undefined,
    mainRoles,
    notes: str(raw.notes, 2000),
    pool: sanitizePool(raw.pool),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
}

/** Valida só as chaves conhecidas; chave inválida lança erro, chave desconhecida é ignorada. */
export function sanitizeSettingsPatch(raw: unknown): Partial<AppSettings> {
  if (!isRecord(raw)) throw new Error('Configuração inválida')
  const out: Partial<AppSettings> = {}

  if ('lockfilePath' in raw) {
    const v = raw.lockfilePath
    if (v === null) out.lockfilePath = null
    else if (typeof v === 'string' && v.length <= 500 && path.isAbsolute(v)) out.lockfilePath = v
    else throw new Error('Configuração inválida: lockfilePath')
  }
  if ('ddragonVersion' in raw) {
    const v = raw.ddragonVersion
    if (v === 'auto' || (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v))) out.ddragonVersion = v
    else throw new Error('Configuração inválida: ddragonVersion')
  }
  if ('locale' in raw) {
    const v = raw.locale
    if (typeof v === 'string' && /^[a-z]{2}_[A-Z]{2}$/.test(v)) out.locale = v
    else throw new Error('Configuração inválida: locale')
  }
  if ('lastActiveProfileId' in raw) {
    const v = raw.lastActiveProfileId
    if (v === null) out.lastActiveProfileId = null
    else if (typeof v === 'string' && v.length > 0 && v.length <= 64) out.lastActiveProfileId = v
    else throw new Error('Configuração inválida: lastActiveProfileId')
  }
  if ('metaUrl' in raw) {
    const v = raw.metaUrl
    if (v === null || v === '') out.metaUrl = null
    else if (typeof v === 'string' && v.length <= 500 && isHttpsUrl(v.trim())) out.metaUrl = v.trim()
    else throw new Error('Endereço inválido: use um link que comece com https://')
  }
  if ('metaAutoUpdate' in raw) {
    if (typeof raw.metaAutoUpdate === 'boolean') out.metaAutoUpdate = raw.metaAutoUpdate
    else throw new Error('Configuração inválida: metaAutoUpdate')
  }
  if ('metaRegion' in raw) {
    const v = raw.metaRegion
    if (v === 'global' || (typeof v === 'string' && /^[a-z0-9]{2,8}$/.test(v))) out.metaRegion = v
    else throw new Error('Configuração inválida: metaRegion')
  }
  if ('pickMode' in raw) {
    if (raw.pickMode === 'balanced' || raw.pickMode === 'comfort' || raw.pickMode === 'meta') out.pickMode = raw.pickMode
    else throw new Error('Configuração inválida: pickMode')
  }
  if ('autoAccept' in raw) {
    if (typeof raw.autoAccept === 'boolean') out.autoAccept = raw.autoAccept
    else throw new Error('Configuração inválida: autoAccept')
  }
  if ('autoAcceptDelay' in raw) {
    const v = raw.autoAcceptDelay
    if (typeof v === 'number' && Number.isFinite(v)) out.autoAcceptDelay = Math.min(8, Math.max(0, Math.round(v)))
    else throw new Error('Configuração inválida: autoAcceptDelay')
  }
  if ('overlayCorner' in raw) {
    if (raw.overlayCorner === 'tl' || raw.overlayCorner === 'tr' || raw.overlayCorner === 'bl' || raw.overlayCorner === 'br') out.overlayCorner = raw.overlayCorner
    else throw new Error('Configuração inválida: overlayCorner')
  }
  if ('overlayOpacity' in raw) {
    const v = raw.overlayOpacity
    if (typeof v === 'number' && Number.isFinite(v)) out.overlayOpacity = Math.round(Math.min(1, Math.max(0.4, v)) * 20) / 20
    else throw new Error('Configuração inválida: overlayOpacity')
  }
  if ('overlayPos' in raw) {
    const v = raw.overlayPos as { x?: unknown; y?: unknown } | null
    if (v === null) out.overlayPos = null
    else if (typeof v === 'object' && v !== undefined && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y) && Math.abs(v.x) < 30000 && Math.abs(v.y) < 30000) out.overlayPos = { x: Math.round(v.x), y: Math.round(v.y) }
    else throw new Error('Configuração inválida: overlayPos')
  }
  for (const key of ['introAnimation', 'reduceMotion', 'tourDone', 'overlayEnabled', 'overlayCompact'] as const) {
    if (key in raw) {
      if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean
      else throw new Error(`Configuração inválida: ${key}`)
    }
  }
  return out
}

export class ProfileStore {
  private data: ProfilesFile = { schemaVersion: 1, settings: { ...DEFAULT_SETTINGS }, profiles: [] }
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    let text: string
    try {
      text = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return // primeira execução
      throw err
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Nunca apaga dados do usuário: guarda o arquivo ruim ao lado e recomeça limpo.
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`)
      return
    }
    if (!isRecord(parsed)) return

    const settings: AppSettings = { ...DEFAULT_SETTINGS }
    if (isRecord(parsed.settings)) {
      for (const [k, v] of Object.entries(parsed.settings)) {
        try {
          Object.assign(settings, sanitizeSettingsPatch({ [k]: v }))
        } catch {
          /* valor inválido: mantém o padrão */
        }
      }
    }

    const profiles: FriendProfile[] = []
    if (Array.isArray(parsed.profiles)) {
      for (const item of parsed.profiles) {
        try {
          const meta =
            isRecord(item) && typeof item.id === 'string' && item.id && typeof item.createdAt === 'string'
              ? { id: item.id.slice(0, 64), createdAt: item.createdAt }
              : undefined
          const p = sanitizeProfile(item, meta)
          if (isRecord(item) && typeof item.updatedAt === 'string') p.updatedAt = item.updatedAt
          profiles.push(p)
        } catch {
          /* perfil ilegível: ignora */
        }
      }
    }
    this.data = { schemaVersion: 1, settings, profiles }
  }

  getSettings(): AppSettings {
    return { ...this.data.settings }
  }

  async updateSettings(patch: unknown): Promise<AppSettings> {
    Object.assign(this.data.settings, sanitizeSettingsPatch(patch))
    await this.persist()
    return this.getSettings()
  }

  list(): FriendProfile[] {
    return structuredClone(this.data.profiles)
  }

  get(id: string): FriendProfile | undefined {
    return this.data.profiles.find((p) => p.id === id)
  }

  async upsert(raw: unknown): Promise<FriendProfile> {
    const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id : null
    const existing = id ? this.get(id) : undefined
    const profile = sanitizeProfile(raw, existing)
    // O puuid é aprendido pelo app: mantém o que já havia, desde que o Riot ID não tenha mudado.
    if (!profile.puuid && existing?.puuid && (existing.riotId ?? '') === (profile.riotId ?? '')) profile.puuid = existing.puuid

    const idx = this.data.profiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) this.data.profiles[idx] = profile
    else this.data.profiles.push(profile)
    if (!this.data.settings.lastActiveProfileId) this.data.settings.lastActiveProfileId = profile.id

    await this.persist()
    return structuredClone(profile)
  }

  /** Grava o puuid reconhecido de um amigo (sem mexer em `updatedAt`). */
  async learnPuuid(id: string, puuid: string): Promise<void> {
    const p = this.get(id)
    if (!p || p.puuid === puuid || !/^[\w-]{8,100}$/.test(puuid)) return
    p.puuid = puuid
    await this.persist()
  }

  /** A conta logada pertence a este perfil: grava Riot ID e puuid e marca como "você". */
  async claim(id: string, who: { puuid: string; riotId: string }): Promise<FriendProfile | null> {
    const p = this.get(id)
    if (!p) return null
    // Uma conta só pode estar em um perfil.
    for (const other of this.data.profiles) if (other.id !== id && other.puuid === who.puuid) delete other.puuid
    p.riotId = who.riotId.slice(0, 40)
    p.puuid = who.puuid
    this.data.settings.lastActiveProfileId = id
    await this.persist()
    return structuredClone(p)
  }

  async remove(id: string): Promise<boolean> {
    const before = this.data.profiles.length
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id)
    if (this.data.profiles.length === before) return false
    if (this.data.settings.lastActiveProfileId === id) {
      this.data.settings.lastActiveProfileId = this.data.profiles[0]?.id ?? null
    }
    await this.persist()
    return true
  }

  /** Restaura perfis de um backup: o mesmo id é substituído, os novos são adicionados. Nada é apagado. */
  async restore(items: readonly unknown[], settings: Partial<AppSettings> = {}): Promise<{ added: number; updated: number; skipped: number }> {
    let added = 0
    let updated = 0
    let skipped = 0
    for (const item of items) {
      try {
        const meta =
          isRecord(item) && typeof item.id === 'string' && item.id && typeof item.createdAt === 'string'
            ? { id: item.id.slice(0, 64), createdAt: item.createdAt }
            : undefined
        const p = sanitizeProfile(item, meta)
        if (isRecord(item) && typeof item.updatedAt === 'string') p.updatedAt = item.updatedAt
        const idx = this.data.profiles.findIndex((x) => x.id === p.id)
        if (idx >= 0) {
          this.data.profiles[idx] = p
          updated++
        } else {
          this.data.profiles.push(p)
          added++
        }
      } catch {
        skipped++
      }
    }
    Object.assign(this.data.settings, settings)
    if (!this.data.settings.lastActiveProfileId && this.data.profiles[0]) this.data.settings.lastActiveProfileId = this.data.profiles[0].id
    await this.persist()
    return { added, updated, skipped }
  }

  /** Serializa as gravações para dois saves seguidos nunca se atropelarem. */
  private persist(): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(() => writeJsonAtomic(this.file, this.data, true))
    return this.queue
  }
}
