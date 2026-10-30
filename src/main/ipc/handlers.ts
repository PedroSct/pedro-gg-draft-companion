// src/main/ipc/handlers.ts  (substitui a versão do Módulo 2)
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, clipboard, dialog, ipcMain, type BrowserWindow } from 'electron'
import { LcuConnector } from '../lcu/connector'
import { resolveInstallDir } from '../lcu/installDir'
import { ProfileStore } from '../store/profiles'
import { DataDragon } from '../data/ddragon'
import { MetaStore, MetaUpdateError } from '../data/meta'
import { recommend } from '../data/recommender'
import { ROLES } from '../../shared/dataTypes'
import { DEFAULT_META_URL, DEFAULT_UPDATE_REPO } from '../../shared/config'
import { decodeShare, encodeShare, toFileJson } from '../store/share'
import { UpdateService, pickAutoUpdater, type UpdaterLike } from '../updater'
import { AutoAccept } from '../autoAccept'
import { PostGameStore } from '../postgame/store'
import { PostGameCollector } from '../postgame/collector'
import type { ShareOptions } from '../../shared/poolShare'
import type { UpdateMetaResult } from '../../shared/api'
import type { Role } from '../../shared/types'
import { IPC } from './channels'

export interface AppServices {
  lcu: LcuConnector
  profiles: ProfileStore
  ddragon: DataDragon
  meta: MetaStore
  updates: UpdateService
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.removeHandler(channel) // evita "handler já registrado" se a janela for recriada (macOS)
  ipcMain.handle(channel, (_event: unknown, ...args: unknown[]) => fn(...args))
}

/**
 * Cria os serviços e registra todos os canais IPC. Chame no index.ts depois de criar a janela:
 *
 *   const services = await registerIpc(mainWindow)
 *
 * Tudo que o renderer envia é validado aqui ou nos serviços (o renderer não é confiável).
 */
export async function registerIpc(win: BrowserWindow): Promise<AppServices> {
  const userData = app.getPath('userData') // por usuário/PC; sobrevive a atualizações e reinstalações
  const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')

  const profiles = new ProfileStore(path.join(userData, 'profiles.json'))
  await profiles.load()

  const meta = new MetaStore(path.join(userData, 'meta', 'meta.json'), path.join(resourcesDir, 'meta.sample.json'))
  await meta.load()

  const ddragon = new DataDragon({
    cacheDir: path.join(userData, 'ddragon'),
    getLocale: () => profiles.getSettings().locale
  })

  // Pasta do LoL: lida a cada tentativa de conexão, então mudar nas configurações vale na hora.
  const lcu = new LcuConnector(() => profiles.getSettings().lockfilePath)

  // ---- LCU → renderer
  const send = (channel: string, payload?: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  lcu.on('status', (s) => {
    console.log('[lcu] status:', s) // nunca logar credenciais
    send(IPC.LCU_STATUS, s)
  })
  lcu.on('draft', (d) => send(IPC.DRAFT_UPDATE, d))
  lcu.on('draft-ended', () => send(IPC.DRAFT_ENDED))

  // Aceitar a partida encontrada (opcional, desligado por padrão)
  const autoAccept = new AutoAccept({
    isEnabled: () => profiles.getSettings().autoAccept,
    getDelaySec: () => profiles.getSettings().autoAcceptDelay,
    accept: () => lcu.acceptReadyCheck(),
    onAccepted: () => {
      console.log('[lcu] partida aceita automaticamente')
      send(IPC.MATCH_AUTO_ACCEPTED)
    }
  })
  lcu.on('ready-check', (check) => autoAccept.update(check))

  // ---- Pós-jogo: ao terminar a partida, lê o resultado e a timeline no cliente e analisa
  const postGames = new PostGameStore(path.join(userData, 'postgame', 'history.json'), path.join(userData, 'postgame', 'raw'))
  const champKeys = new Map<number, string>()
  async function warmChampionKeys(): Promise<void> {
    if (champKeys.size > 0) return
    try {
      const cat = await ddragon.getCatalog(await currentVersion())
      for (const c of cat.champions) champKeys.set(c.id, c.key)
    } catch {
      /* sem catálogo: as rotas ausentes ficam em branco */
    }
  }
  const collector = new PostGameCollector({
    get: (p) => lcu.get(p),
    store: postGames,
    champKeyOf: (id) => champKeys.get(id) ?? null,
    onReady: (summary) => send(IPC.POSTGAME_READY, summary)
  })
  lcu.on('gameflow', (phase) => {
    void warmChampionKeys().then(() => collector.onPhase(phase))
  })
  handle(IPC.POSTGAME_LIST, () => postGames.list())
  handle(IPC.POSTGAME_GET, (id) => (typeof id === 'number' ? postGames.get(id) : null))
  handle(IPC.POSTGAME_DELETE, async (id) => {
    if (typeof id !== 'number') return false
    await postGames.remove(id)
    return true
  })
  handle(IPC.POSTGAME_FETCH_LATEST, async () => {
    await warmChampionKeys()
    return collector.collectLatest()
  })

  handle(IPC.LCU_GET_STATUS, () => lcu.getStatus())
  handle(IPC.DRAFT_GET_CURRENT, () => lcu.getLastDraft())

  // ---- Configurações e escolha da pasta do LoL
  handle(IPC.SETTINGS_GET, () => profiles.getSettings())
  handle(IPC.SETTINGS_SET, async (patch) => {
    const settings = await profiles.updateSettings(patch)
    autoAccept.enabledChanged()
    return settings
  })
  handle(IPC.SETTINGS_PICK_GAME_DIR, async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Selecione a pasta do League of Legends',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, reason: 'canceled' }
    const dir = await resolveInstallDir(res.filePaths[0])
    if (!dir) return { ok: false, reason: 'not-lol' }
    await profiles.updateSettings({ lockfilePath: dir })
    return { ok: true, path: dir }
  })

  // ---- Perfis e Pools
  handle(IPC.PROFILES_LIST, () => profiles.list())
  handle(IPC.PROFILES_SAVE, (raw) => profiles.upsert(raw))
  handle(IPC.PROFILES_DELETE, (id) => (typeof id === 'string' ? profiles.remove(id) : false))

  // ---- Data Dragon (versão acompanha o patch do cliente quando em "auto")
  async function currentVersion(): Promise<string> {
    let gameVersion: string | null = null
    try {
      const r = await lcu.get('/system/v1/builds')
      const v = isRecord(r.data) ? r.data.version : null
      if (r.status === 200 && typeof v === 'string') gameVersion = v
    } catch {
      /* cliente fechado: usa a versão mais recente do Data Dragon */
    }
    return ddragon.resolveVersion(profiles.getSettings().ddragonVersion, gameVersion)
  }
  handle(IPC.DDRAGON_GET_CATALOG, async () => ddragon.getCatalog(await currentVersion()))
  handle(IPC.DDRAGON_GET_SPELLS, async (key) => {
    if (typeof key !== 'string') throw new Error('Campeão inválido')
    return ddragon.getSpells(await currentVersion(), key)
  })

  // ---- Meta (matchups/builds)
  handle(IPC.META_INFO, () => meta.info())
  handle(IPC.META_GET_BUILD, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const role = req.role as Role
    if (typeof req.championId !== 'number' || !ROLES.includes(role)) return null
    return meta.getBuild(req.championId, role)
  })
  handle(IPC.META_IMPORT, async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Importar dados de meta (JSON)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, reason: 'canceled' }
    try {
      return { ok: true, info: await meta.importFrom(res.filePaths[0]) }
    } catch (err) {
      return { ok: false, reason: 'invalid', message: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- Atualização do meta pela internet (endereço do usuário, ou o padrão do instalador)
  const metaUrl = (): string | null => profiles.getSettings().metaUrl ?? (DEFAULT_META_URL || null)

  async function updateMeta(): Promise<UpdateMetaResult> {
    const url = metaUrl()
    if (!url) return { ok: false, reason: 'no-url' }
    try {
      const r = await meta.updateFromUrl(url)
      return { ok: true, changed: r.changed, info: r.info }
    } catch (err) {
      if (err instanceof MetaUpdateError) return { ok: false, reason: err.kind, message: err.message }
      return { ok: false, reason: 'network', message: 'Falha inesperada ao atualizar' }
    }
  }
  handle(IPC.META_UPDATE, updateMeta)

  // Ao abrir o app, atualiza em segundo plano; falhas ficam em silêncio (o app segue com o que já tem).
  if (profiles.getSettings().metaAutoUpdate && metaUrl()) {
    void updateMeta().then((r) => {
      if (r.ok && r.changed) send(IPC.META_UPDATED, r.info)
    })
  }

  // ---- Recomendação (usa o último draft recebido da LCU)
  handle(IPC.DRAFT_RECOMMEND, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const profile = typeof req.profileId === 'string' ? profiles.get(req.profileId) : undefined
    const draft = lcu.getLastDraft()
    if (!profile || !draft) return null
    const role = ROLES.includes(req.role as Role) ? (req.role as Role) : null
    return recommend({ draft, profile, dataset: meta.get(), role, mode: profiles.getSettings().pickMode })
  })

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
  handle(IPC.CLIPBOARD_WRITE, async (text) => {
    if (typeof text === 'string' && text.length <= 400_000) await clipboard.writeText(text)
  })
  handle(IPC.CLIPBOARD_READ, async () => (await clipboard.readText()).slice(0, 400_000))

  // ---- Atualização do app (Releases do GitHub)
  let updaterImpl: UpdaterLike | null = null
  if (app.isPackaged) {
    try {
      // electron-updater é CommonJS: no app empacotado o `autoUpdater` pode vir só em `default`.
      updaterImpl = pickAutoUpdater(await import('electron-updater'))
      if (!updaterImpl) console.log('[update] indisponível: autoUpdater não encontrado no módulo')
    } catch (err) {
      console.log('[update] indisponível:', err instanceof Error ? err.message : err)
    }
  }
  const updates = new UpdateService({
    updater: updaterImpl,
    currentVersion: app.getVersion(),
    repo: (typeof __UPDATE_REPO__ === 'string' ? __UPDATE_REPO__ : '') || DEFAULT_UPDATE_REPO,
    packaged: app.isPackaged,
    onState: (s) => send(IPC.UPDATE_STATE, s)
  })
  handle(IPC.UPDATE_GET, () => updates.getState())
  handle(IPC.UPDATE_CHECK, () => updates.check(true))
  handle(IPC.UPDATE_DOWNLOAD, () => updates.download())
  handle(IPC.UPDATE_INSTALL, () => updates.install())
  updates.startSchedule()

  win.on('closed', () => {
    lcu.stop()
    autoAccept.stop()
    updates.stop()
  })
  lcu.start()
  return { lcu, profiles, ddragon, meta, updates }
}
