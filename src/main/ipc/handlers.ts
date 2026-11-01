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
import { buildSituation } from '../data/situation'
import { championDetail, tierRows } from '../data/metaStats'
import { ROLES, type ChampionInfo, type ItemInfo } from '../../shared/dataTypes'
import { DEFAULT_META_URL, DEFAULT_UPDATE_REPO } from '../../shared/config'
import { decodeShare, encodeShare, toFileJson } from '../store/share'
import { UpdateService, pickAutoUpdater, type UpdaterLike } from '../updater'
import { AutoAccept } from '../autoAccept'
import { Diagnostics } from '../diagnostics'
import { applyLoadout } from '../lcu/loadout'
import { PostGameStore } from '../postgame/store'
import { PostGameCollector } from '../postgame/collector'
import type { ShareOptions } from '../../shared/poolShare'
import type { IdentityState, UpdateMetaResult } from '../../shared/api'
import { annotateDraft, findProfileFor, riotIdOf } from '../../shared/identity'
import type { DraftState, Role } from '../../shared/types'
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
  // ---- Identidade: quem é você e quais amigos (com perfil) estão no time
  const identityState = (): IdentityState => {
    const account = lcu.getIdentity()
    const mine = account ? findProfileFor(profiles.list(), { puuid: account.puuid, name: riotIdOf(account) }) : undefined
    return { account, profileId: mine?.id ?? null }
  }
  /** Último draft já marcado com "é você" / "é o amigo X". Grava o puuid dos amigos reconhecidos. */
  const annotatedDraft = (): DraftState | null => {
    const d = lcu.getLastDraft()
    if (!d) return null
    const res = annotateDraft(d, profiles.list(), lcu.getIdentity())
    for (const l of res.learn) void profiles.learnPuuid(l.profileId, l.puuid).catch(() => undefined)
    return res.draft
  }
  const pushDraft = (): void => {
    const d = annotatedDraft()
    if (d) send(IPC.DRAFT_UPDATE, d)
  }
  lcu.on('draft', pushDraft)
  lcu.on('identity', () => {
    send(IPC.IDENTITY_UPDATE, identityState())
    pushDraft()
  })
  lcu.on('draft-ended', () => send(IPC.DRAFT_ENDED))

  // Aceitar a partida encontrada (opcional, desligado por padrão)
  const diag = new Diagnostics(path.join(userData, 'logs', 'diagnostico.log'))
  lcu.setLogger((tag, msg) => diag.log(tag, msg))
  const autoAccept = new AutoAccept({
    isEnabled: () => profiles.getSettings().autoAccept,
    getDelaySec: () => profiles.getSettings().autoAcceptDelay,
    accept: () => lcu.acceptReadyCheck(),
    onAttempt: ({ attempt, ok, status }) => {
      diag.setAccept({ ok, status, at: Date.now() })
      diag.log('aceite', `tentativa ${attempt}: ${ok ? 'aceita' : 'recusada pelo cliente'} (HTTP ${status})`)
    },
    onAccepted: () => {
      console.log('[lcu] partida aceita automaticamente')
      send(IPC.MATCH_AUTO_ACCEPTED)
    }
  })
  lcu.on('ready-check', (check) => autoAccept.update(check))

  // Plano B: em "ReadyCheck" o app também pergunta ao cliente por conta própria, caso o evento não chegue.
  let readyPoll: NodeJS.Timeout | null = null
  const stopReadyPoll = (): void => {
    if (readyPoll) clearInterval(readyPoll)
    readyPoll = null
  }
  lcu.on('gameflow', (phase) => {
    if (phase !== 'ReadyCheck') return stopReadyPoll()
    if (readyPoll || !profiles.getSettings().autoAccept) return
    diag.log('aceite', 'fase ReadyCheck: conferindo o cliente a cada 0,7 s')
    const started = Date.now()
    readyPoll = setInterval(() => {
      if (Date.now() - started > 25_000) return stopReadyPoll()
      void lcu.readReadyCheck().then((c) => {
        if (c) autoAccept.update(c)
      })
    }, 700)
  })

  // ---- Pós-jogo: ao terminar a partida, lê o resultado e a timeline no cliente e analisa
  const postGames = new PostGameStore(path.join(userData, 'postgame', 'history.json'), path.join(userData, 'postgame', 'raw'))
  const champKeys = new Map<number, string>()
  const champNames = new Map<number, string>()
  let champInfos: ChampionInfo[] = []
  let itemInfos: Record<string, ItemInfo> = {}
  async function warmChampionKeys(): Promise<void> {
    if (champKeys.size > 0) return
    try {
      const cat = await ddragon.getCatalog(await currentVersion())
      for (const c of cat.champions) {
        champKeys.set(c.id, c.key)
        champNames.set(c.id, c.name)
      }
      champInfos = cat.champions
      itemInfos = cat.items
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

  handle(IPC.DIAG_REPORT, () =>
    diag.report([
      `Pedro.gg ${app.getVersion()} (${process.platform} ${process.arch})`,
      `Cliente: ${lcu.getStatus()}`,
      `Aceite automático: ${profiles.getSettings().autoAccept ? 'ligado' : 'desligado'}, espera ${profiles.getSettings().autoAcceptDelay}s`
    ])
  )
  handle(IPC.DIAG_ACCEPT, () => diag.getAccept())
  handle(IPC.LCU_GET_STATUS, () => lcu.getStatus())
  handle(IPC.DRAFT_GET_CURRENT, () => annotatedDraft())
  handle(IPC.IDENTITY_GET, () => identityState())
  handle(IPC.ACCOUNT_STATS, () => lcu.getAccountStats())
  handle(IPC.IDENTITY_CLAIM, async (id) => {
    const account = lcu.getIdentity()
    if (typeof id !== 'string' || !account) return identityState()
    await profiles.claim(id, { puuid: account.puuid, riotId: riotIdOf(account) })
    send(IPC.IDENTITY_UPDATE, identityState())
    pushDraft()
    return identityState()
  })

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
  handle(IPC.PROFILES_SAVE, async (raw) => {
    const saved = await profiles.upsert(raw)
    send(IPC.IDENTITY_UPDATE, identityState())
    pushDraft()
    return saved
  })
  handle(IPC.PROFILES_DELETE, async (id) => {
    const ok = typeof id === 'string' ? await profiles.remove(id) : false
    send(IPC.IDENTITY_UPDATE, identityState())
    pushDraft()
    return ok
  })

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
  handle(IPC.META_TIERS, (role) => {
    const ds = meta.get()
    return ds && ROLES.includes(role as Role) ? tierRows(ds, role as Role) : []
  })
  handle(IPC.META_DETAIL, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const ds = meta.get()
    if (!ds || typeof req.championId !== 'number' || !ROLES.includes(req.role as Role)) return null
    return championDetail(ds, req.championId, req.role as Role)
  })
  handle(IPC.META_GET_BUILD, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const role = req.role as Role
    if (typeof req.championId !== 'number' || !ROLES.includes(role)) return null
    return meta.getBuild(req.championId, role)
  })
  // ---- Build ajustada à partida (time inimigo atual)
  handle(IPC.META_BUILD_SITUATION, async (raw) => {
    const req = isRecord(raw) ? raw : {}
    const role = req.role as Role
    const draft = annotatedDraft()
    if (!draft || typeof req.championId !== 'number' || !ROLES.includes(role)) return null
    await warmChampionKeys()
    return buildSituation({
      dataset: meta.get(),
      draft,
      build: meta.getBuild(req.championId, role),
      championId: req.championId,
      champions: champInfos,
      items: itemInfos
    })
  })
  // ---- Importar runas/feitiços/itens para o cliente (só por clique do usuário; a build vem do meta, não do renderer)
  handle(IPC.LOADOUT_APPLY, async (raw) => {
    const req = isRecord(raw) ? raw : {}
    const role = req.role as Role
    const parts = isRecord(req.parts) ? req.parts : {}
    if (typeof req.championId !== 'number' || !ROLES.includes(role)) return { ok: false, message: 'Pedido inválido.' }
    if (lcu.getStatus() !== 'connected') return { ok: false, message: 'O cliente do LoL não está conectado.' }
    const build = meta.getBuild(req.championId, role)
    if (!build) return { ok: false, message: 'Não há build deste campeão nos dados de meta.' }
    await warmChampionKeys()
    const result = await applyLoadout(
      { get: (p) => lcu.get(p), write: (m, p, b) => lcu.write(m, p, b) },
      {
        championId: req.championId,
        championName: champNames.get(req.championId) ?? `Campeão ${req.championId}`,
        role,
        build,
        parts: { runes: parts.runes === true, spells: parts.spells === true, items: parts.items === true }
      }
    )
    return { ok: true, parts: result }
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
  handle(IPC.DRAFT_RECOMMEND, async (raw) => {
    const req = isRecord(raw) ? raw : {}
    const profile = typeof req.profileId === 'string' ? profiles.get(req.profileId) : undefined
    let draft = annotatedDraft()
    if (!profile || !draft) return null
    // Sugestão para um amigo: ele passa a ser o "jogador de referência" (rota, sinergias com os outros).
    if (typeof req.cellId === 'number') {
      const who = draft.allies.find((a) => a.cellId === req.cellId)
      if (!who) return null
      draft = { ...draft, localPlayerCellId: who.cellId, localRole: who.role }
    }
    const role = ROLES.includes(req.role as Role) ? (req.role as Role) : null
    await warmChampionKeys()
    return recommend({ draft, profile, dataset: meta.get(), role, mode: profiles.getSettings().pickMode, champions: champInfos })
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
    stopReadyPoll()
    updates.stop()
  })
  lcu.start()
  return { lcu, profiles, ddragon, meta, updates }
}
