// src/main/store/backup.ts
// Backup de todos os perfis (e algumas preferências) em um arquivo; a restauração valida tudo de novo.
import { sanitizeSettingsPatch } from './profiles'
import type { AppSettings, FriendProfile } from '../../shared/dataTypes'

export const BACKUP_KIND = 'pedro.gg-backup'
const MAX_PROFILES = 200
/** Só preferências que fazem sentido em outro PC (nada de pastas ou endereços). */
const SETTING_KEYS = ['pickMode', 'metaRegion', 'autoAccept', 'autoAcceptDelay', 'reduceMotion', 'tourDone'] as const

export interface BackupFile {
  kind: typeof BACKUP_KIND
  version: 1
  exportedAt: string
  app: string
  settings: Partial<AppSettings>
  profiles: FriendProfile[]
}

export function makeBackup(profiles: readonly FriendProfile[], settings: AppSettings, appVersion: string, now: Date = new Date()): string {
  const picked: Record<string, unknown> = {}
  for (const k of SETTING_KEYS) picked[k] = settings[k]
  const file: BackupFile = {
    kind: BACKUP_KIND,
    version: 1,
    exportedAt: now.toISOString(),
    app: appVersion,
    settings: picked as Partial<AppSettings>,
    profiles: structuredClone([...profiles])
  }
  return JSON.stringify(file, null, 2)
}

export interface ParsedBackup {
  /** ainda não validados: quem restaura passa cada um por sanitizeProfile */
  profiles: unknown[]
  settings: Partial<AppSettings>
}

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Esse arquivo não é um backup do Pedro.gg.')
  }
  if (!raw || typeof raw !== 'object') throw new Error('Esse arquivo não é um backup do Pedro.gg.')
  const o = raw as Record<string, unknown>
  if (o.kind !== BACKUP_KIND) throw new Error('Esse arquivo não é um backup do Pedro.gg.')
  if (o.version !== 1) throw new Error('Esse backup é de uma versão que este app não conhece.')
  if (!Array.isArray(o.profiles)) throw new Error('O backup não tem perfis.')
  if (o.profiles.length > MAX_PROFILES) throw new Error('O backup tem perfis demais.')

  const settings: Partial<AppSettings> = {}
  if (o.settings && typeof o.settings === 'object') {
    for (const k of SETTING_KEYS) {
      const v = (o.settings as Record<string, unknown>)[k]
      if (v === undefined) continue
      try {
        Object.assign(settings, sanitizeSettingsPatch({ [k]: v }))
      } catch {
        /* valor inválido: ignora só esta preferência */
      }
    }
  }
  return { profiles: o.profiles, settings }
}
