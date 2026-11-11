// src/main/ipc/handlers.ts  (substitui a versão do Módulo 2)
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import { LcuConnector } from '../lcu/connector'
import { resolveInstallDir } from '../lcu/installDir'
import { ProfileStore } from '../store/profiles'
import { DataDragon } from '../data/ddragon'
import { MetaStore, MetaUpdateError } from '../data/meta'
import { laneEnemyOf, recommend } from '../data/recommender'
import { buildSituation } from '../data/situation'
import { banPhaseOpen, suggestBans } from '../data/bans'
import { applyBuildSelection, sanitizeSelection, type BuildSelection } from '../../shared/buildSelection'
import { championDetail, rolesOf, tierRows } from '../data/metaStats'
import { suggestPoolFromAccount } from '../lcu/accountPool'
import { ROLES, type ChampionInfo, type ItemInfo } from '../../shared/dataTypes'
import { DEFAULT_META_URL, DEFAULT_UPDATE_REPO, regionUrl } from '../../shared/config'
import { UpdateService, pickAutoUpdater, type UpdaterLike } from '../updater'
import { AutoAccept } from '../autoAccept'
import { patchNotice, snapshotOf, type MetaSnapshot } from '../data/patchChanges'
import { OverlayController } from '../overlay/controller'
import { fetchLive } from '../overlay/live'
import { actInDraft, parseActRequest } from '../lcu/draftAct'
import { suggestMetaCounters } from '../data/counters'
import { Diagnostics, formatProbe, probeClient } from '../diagnostics'
import { applyLoadout } from '../lcu/loadout'
import { PostGameStore } from '../postgame/store'
import { PostGameCollector } from '../postgame/collector'
import type { IdentityState, UpdateMetaResult } from '../../shared/api'
import { annotateDraft, findProfileFor, riotIdOf } from '../../shared/identity'
import type { DraftState, Role } from '../../shared/types'
import { IPC } from './channels'
import { handle, isRecord } from './handle'
import { registerFileIpc } from './fileHandlers'

export interface AppServices {
  lcu: LcuConnector
  profiles: ProfileStore
  ddragon: DataDragon
  meta: MetaStore
  updates: UpdateService
}

/**
 * Cria os serviços e registra todos os canais IPC. Chame no index.ts depois de criar a janela:
 *
 *   const services = await registerIpc(mainWindow)
 *
 * Tudo que o renderer envia é validado aqui ou nos serviços (o renderer não é confiável).
 */
export async function registerIpc(win: BrowserWindow, devUrl?: string): Promise<AppServices> {
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
  // Rota e campeão do último draft: o overlay usa quando o jogo não informa a rota.
  let lastPick: { championId: number; role: Role } | null = null
  const pushDraft = (): void => {
    const d = annotatedDraft()
    if (d) {
      send(IPC.DRAFT_UPDATE, d)
      const me = d.allies.find((a) => a.cellId === d.localPlayerCellId)
      if (me && me.championId > 0 && d.localRole) lastPick = { championId: me.championId, role: d.localRole }
    }
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
  let gameflowPhase: string | null = null
  lcu.on('gameflow', (phase) => {
    gameflowPhase = phase
    send(IPC.GAMEFLOW_PHASE, phase)
  })
  handle(IPC.GAMEFLOW_GET, () => gameflowPhase)
  lcu.on('gameflow', (phase) => {
    if (phase !== 'ReadyCheck') {
      autoAccept.reset()
      return stopReadyPoll()
    }
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

  const diagReport = (): string => {
    const st = profiles.getSettings()
    const info = meta.info()
    return diag.report([
      `Pedro.gg ${app.getVersion()} (${process.platform} ${process.arch}, Electron ${process.versions.electron})`,
      `Cliente do LoL: ${lcu.getStatus()}`,
      `Dados de meta: ${info ? `patch ${info.patch}, ${info.champions} campeões, gerado em ${info.generatedAt}${info.isSample ? ' (AMOSTRA)' : ''}${info.regions ? `, servidores ${info.regions.join('/')}` : ''}` : 'nenhum'}`,
      `Região do meta: ${st.metaRegion ?? 'global'}`,
      `Aceite automático: ${st.autoAccept ? 'ligado' : 'desligado'}, espera ${st.autoAcceptDelay}s`,
      `Última tentativa de aceite: ${diag.getAccept() ? `${diag.getAccept()?.ok ? 'ok' : 'falhou'} (HTTP ${diag.getAccept()?.status})` : 'nenhuma'}`,
      `Overlay: ${overlay.getStatus()}`,
      `Atalhos do overlay: ${overlay.getShortcutStatus()}`,
      `Perfis: ${profiles.list().length}`
    ])
  }
  handle(IPC.DIAG_REPORT, () => diagReport())
  handle(IPC.DIAG_SAVE, async () => {
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      const res = await dialog.showSaveDialog(win, {
        title: 'Salvar relatório de diagnóstico',
        defaultPath: path.join(app.getPath('documents'), `Pedro.gg-diagnostico-${stamp}.txt`),
        filters: [{ name: 'Texto', extensions: ['txt'] }]
      })
      if (res.canceled || !res.filePath) return { ok: false }
      await fs.writeFile(res.filePath, diagReport(), 'utf8')
      return { ok: true, path: res.filePath }
    } catch {
      return { ok: false }
    }
  })
  handle(IPC.DIAG_PROBE, async () => {
    if (lcu.getStatus() !== 'connected') return ['O cliente do LoL não está conectado.']
    const lines = formatProbe(await probeClient({ get: (p) => lcu.get(p), live: async () => (await fetchLive(1000)) !== null }))
    for (const l of lines) diag.log('teste', l)
    return lines
  })
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
    overlay.refresh()
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
  /** Oponente de rota desta partida (para trocar as runas e feitiços pelos do confronto); null se não é certo. */
  const laneEnemy = (role: Role): number | null => {
    const d = annotatedDraft()
    const ds = meta.get()
    return d && ds ? laneEnemyOf(d, ds, role) : null
  }
  handle(IPC.META_GET_BUILD, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const role = req.role as Role
    if (typeof req.championId !== 'number' || !ROLES.includes(role)) return null
    return meta.getBuild(req.championId, role, laneEnemy(role))
  })
  // ---- Sugestões de banimento (só enquanto os bans ainda estão abertos)
  // ---- Escolher/banir pelo app: uma ação por clique, na vez da pessoa; o main confere tudo no cliente
  handle(IPC.DRAFT_ACT, async (raw) => {
    const req = parseActRequest(raw)
    if (!req) return { ok: false, message: 'Pedido inválido.' }
    if (lcu.getStatus() !== 'connected') return { ok: false, message: 'O cliente do LoL não está conectado.' }
    try {
      const res = await actInDraft({ get: (p) => lcu.get(p), write: (m, p, b) => lcu.write(m, p, b) }, req)
      diag.log('escolha', `${req.type} ${req.kind} ${req.championId}: ${res.ok ? 'ok' : res.message}`)
      return res
    } catch {
      return { ok: false, message: 'Não consegui falar com o cliente do LoL.' }
    }
  })
  handle(IPC.DRAFT_BANS, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const draft = annotatedDraft()
    if (!draft || !banPhaseOpen(draft)) return []
    return suggestBans({
      draft,
      dataset: meta.get(),
      profiles: profiles.list(),
      fallbackProfileId: typeof req.profileId === 'string' ? req.profileId : undefined
    })
  })
  // ---- Aviso de mudança de patch (só para campeões das suas Pools)
  const seenFile = path.join(userData, 'meta-seen.json')
  const readSeen = async (): Promise<MetaSnapshot | null> => {
    try {
      const j = JSON.parse(await fs.readFile(seenFile, 'utf8')) as MetaSnapshot
      return j && typeof j.patch === 'string' && j.rows && typeof j.rows === 'object' ? j : null
    } catch {
      return null
    }
  }
  const writeSeen = async (): Promise<void> => {
    const ds = meta.get()
    if (!ds || ds.isSample) return
    try {
      await fs.mkdir(path.dirname(seenFile), { recursive: true })
      await fs.writeFile(seenFile, JSON.stringify(snapshotOf(ds)), 'utf8')
    } catch {
      /* sem permissão de escrita: o aviso só repete na próxima abertura */
    }
  }
  handle(IPC.META_PATCH_CHANGES, async () => {
    const { notice, ack } = patchNotice(await readSeen(), meta.get(), profiles.list())
    if (ack) await writeSeen()
    return notice
  })
  handle(IPC.META_PATCH_ACK, () => writeSeen())
  // ---- Overlay dentro do jogo (opcional): próxima habilidade e itens da build, lidos da API oficial da partida
  const lastSelections = new Map<string, BuildSelection>()
  const keyToId = (key: string): number | null => {
    for (const [id, k] of champKeys) if (k.toLowerCase() === key.toLowerCase()) return id
    return null
  }
  const overlay = new OverlayController(
    {
      getSettings: () => profiles.getSettings(),
      situation: (championId, role, enemyIds) => {
        const draft = { enemies: enemyIds.map((id, i) => ({ cellId: 5 + i, championId: id, status: 'locked', role: null })), allies: [] } as unknown as DraftState
        const s = buildSituation({ dataset: meta.get(), draft, build: meta.getBuild(championId, role), championId, champions: champInfos, items: itemInfos })
        if (!s.enemyDamage) return null
        return { focus: s.focus, physical: s.enemyDamage.physical, magic: s.enemyDamage.magic, picks: s.picks }
      },
      saveSettings: async (patch) => {
        await profiles.updateSettings(patch)
      },
      savePosition: async (pos) => {
        await profiles.updateSettings({ overlayPos: pos })
      },
      getDataset: () => meta.get(),
      getBuild: (id, role) => meta.getBuild(id, role),
      idOfKey: keyToId,
      nameOf: (id) => champNames.get(id) ?? `Campeão ${id}`,
      lastSelection: (id, role) => lastSelections.get(`${id}|${role}`) ?? null,
      lastDraftPick: () => lastPick,
      warm: warmChampionKeys,
      send,
      channel: IPC.OVERLAY_STATE,
      log: (m) => diag.log('overlay', m)
    },
    win,
    devUrl
  )
  handle(IPC.OVERLAY_GET, () => overlay.getState())
  handle(IPC.OVERLAY_MOVE_START, async () => {
    await warmChampionKeys()
    return overlay.startMove()
  })
  handle(IPC.OVERLAY_MOVE_DONE, () => overlay.finishMove())
  handle(IPC.OVERLAY_PREVIEW, async () => {
    await warmChampionKeys()
    return overlay.preview()
  })
  overlay.refresh()

  // ---- Importar a Pool da conta logada no cliente (partidas recentes + maestria, só leitura)
  handle(IPC.POOL_FROM_ACCOUNT, async () => {
    const ds = meta.get()
    return suggestPoolFromAccount((p) => lcu.get(p), (id) => (ds && !ds.isSample ? (rolesOf(ds, id)[0] ?? null) : null))
  })
  // ---- Melhor pick do meta contra o inimigo da rota, fora da Pool
  handle(IPC.DRAFT_COUNTERS, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const draft = annotatedDraft()
    if (!draft || draft.phase === 'FINALIZATION') return []
    const me = draft.allies.find((a) => a.cellId === draft.localPlayerCellId)
    if (me && me.status === 'locked' && me.championId > 0) return []
    const profile = (me?.profileId ? profiles.get(me.profileId) : undefined) ?? (typeof req.profileId === 'string' ? profiles.get(req.profileId) : undefined)
    return suggestMetaCounters({ draft, dataset: meta.get(), profile, role: draft.localRole })
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
    const base = meta.getBuild(req.championId, role, laneEnemy(role))
    if (!base) return { ok: false, message: 'Não há build deste campeão nos dados de meta.' }
    // A opção escolhida na tela (só índices): quem monta a build é o main, a partir do meta.
    const build = applyBuildSelection(base, sanitizeSelection(req.selection))
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
    lastSelections.set(`${req.championId}|${role}`, sanitizeSelection(req.selection))
    diag.log('build', `importação ${req.championId}/${role}: ${JSON.stringify(result).slice(0, 200)}`)
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
  const metaUrl = (): string | null => {
    const s = profiles.getSettings()
    const base = s.metaUrl ?? (DEFAULT_META_URL || null)
    return base ? regionUrl(base, s.metaRegion) : null
  }

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

  registerFileIpc(win, profiles)

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
