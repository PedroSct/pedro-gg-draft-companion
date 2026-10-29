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
  pickMode: 'balanced'
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
  if ('pickMode' in raw) {
    if (raw.pickMode === 'balanced' || raw.pickMode === 'comfort' || raw.pickMode === 'meta') out.pickMode = raw.pickMode
    else throw new Error('Configuração inválida: pickMode')
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

    const idx = this.data.profiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) this.data.profiles[idx] = profile
    else this.data.profiles.push(profile)
    if (!this.data.settings.lastActiveProfileId) this.data.settings.lastActiveProfileId = profile.id

    await this.persist()
    return structuredClone(profile)
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

  /** Serializa as gravações para dois saves seguidos nunca se atropelarem. */
  private persist(): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(() => writeJsonAtomic(this.file, this.data, true))
    return this.queue
  }
}
