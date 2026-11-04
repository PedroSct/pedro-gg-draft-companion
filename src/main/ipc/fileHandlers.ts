// src/main/ipc/fileHandlers.ts
// IPC que mexe com arquivos escolhidos pelo usuário e com a área de transferência:
// compartilhar Pool (código/arquivo), backup dos perfis e copiar/colar texto.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, clipboard, dialog, type BrowserWindow } from 'electron'
import type { ProfileStore } from '../store/profiles'
import { decodeShare, encodeShare, toFileJson } from '../store/share'
import { makeBackup, parseBackup } from '../store/backup'
import type { ShareOptions } from '../../shared/poolShare'
import { IPC } from './channels'
import { handle, isRecord } from './handle'

export function registerFileIpc(win: BrowserWindow, profiles: ProfileStore): void {
  // ---- Compartilhar Pool (código ou arquivo)
  const shareOpts = (raw: unknown): ShareOptions => ({ includeNotes: isRecord(raw) && raw.includeNotes === true })
  const MAX_SHARE_FILE = 2 * 1024 * 1024

  handle(IPC.SHARE_ENCODE, (profile, opts) => encodeShare(profile, shareOpts(opts)))
  handle(IPC.SHARE_DECODE, (text) => decodeShare(text))
  handle(IPC.SHARE_EXPORT_FILE, async (profile, opts) => {
    try {
      const json = toFileJson(profile, shareOpts(opts))
      const nick = String(isRecord(profile) ? profile.nickname : 'pool').replace(/[^\w.-]+/g, '_').slice(0, 30) || 'pool'
      const res = await dialog.showSaveDialog(win, {
        title: 'Salvar Pool para enviar a um amigo',
        defaultPath: path.join(app.getPath('documents'), `Pool-${nick}.pedrogg.json`),
        filters: [{ name: 'Pool do Pedro.gg', extensions: ['json'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' }
      await fs.writeFile(res.filePath, json, 'utf8')
      return { ok: true, path: res.filePath }
    } catch {
      return { ok: false, reason: 'error' }
    }
  })
  handle(IPC.SHARE_IMPORT_FILE, async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Abrir a Pool de um amigo',
      properties: ['openFile'],
      filters: [{ name: 'Pool do Pedro.gg', extensions: ['json', 'txt'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, reason: 'canceled' }
    try {
      const stat = await fs.stat(res.filePaths[0])
      if (stat.size > MAX_SHARE_FILE) return { ok: false, reason: 'invalid', message: 'O arquivo é grande demais para ser uma Pool.' }
      const decoded = decodeShare(await fs.readFile(res.filePaths[0], 'utf8'))
      return decoded.ok ? decoded : { ok: false, reason: 'invalid', message: decoded.message }
    } catch {
      return { ok: false, reason: 'invalid', message: 'Não consegui ler esse arquivo.' }
    }
  })
  // ---- Backup de todos os perfis
  handle(IPC.BACKUP_EXPORT, async () => {
    try {
      const day = new Date().toISOString().slice(0, 10)
      const res = await dialog.showSaveDialog(win, {
        title: 'Salvar backup dos perfis',
        defaultPath: path.join(app.getPath('documents'), `Pedro.gg-backup-${day}.json`),
        filters: [{ name: 'Backup do Pedro.gg', extensions: ['json'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' }
      const list = profiles.list()
      await fs.writeFile(res.filePath, makeBackup(list, profiles.getSettings(), app.getVersion()), 'utf8')
      return { ok: true, path: res.filePath, profiles: list.length }
    } catch {
      return { ok: false, reason: 'error' }
    }
  })
  handle(IPC.BACKUP_IMPORT, async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Restaurar backup dos perfis',
      properties: ['openFile'],
      filters: [{ name: 'Backup do Pedro.gg', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, reason: 'canceled' }
    try {
      const stat = await fs.stat(res.filePaths[0])
      if (stat.size > 8 * 1024 * 1024) return { ok: false, reason: 'invalid', message: 'O arquivo é grande demais para ser um backup.' }
      const parsed = parseBackup(await fs.readFile(res.filePaths[0], 'utf8'))
      return { ok: true, ...(await profiles.restore(parsed.profiles, parsed.settings)) }
    } catch (err) {
      return { ok: false, reason: 'invalid', message: err instanceof Error ? err.message : 'Não consegui ler esse arquivo.' }
    }
  })
  handle(IPC.CLIPBOARD_WRITE, async (text) => {
    if (typeof text === 'string' && text.length <= 400_000) await clipboard.writeText(text)
  })
  handle(IPC.CLIPBOARD_READ, async () => (await clipboard.readText()).slice(0, 400_000))
}
