// src/main/ipc/handlers.ts  (substitui a versão do Módulo 2)
import { promises as fs, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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
import { applyBuildSelection, sanitizeSelection, ZERO_SELECTION, type BuildSelection } from '../../shared/buildSelection'
import { championDetail, rolesOf, tierRows } from '../data/metaStats'
import { synergyPairs } from '../data/synergies'
import { analyzeGroup, type GroupMemberInput } from '../data/group'
import { readAccount, suggestPoolFromAccount } from '../lcu/accountPool'
import { analyzeCoach, type CoachResult } from '../../shared/coach'
import { classifyCatalog } from '../../shared/itemAdvice'
import { ROLES, type ChampionInfo, type ItemInfo } from '../../shared/dataTypes'
import { DEFAULT_META_URL, DEFAULT_UPDATE_REPO, regionUrl } from '../../shared/config'
import { UpdateService, pickAutoUpdater, type UpdaterLike } from '../updater'
import { AutoAccept } from '../autoAccept'
import { patchNotice, snapshotOf, type MetaSnapshot } from '../data/patchChanges'
import { OverlayController } from '../overlay/controller'
import { fetchLive } from '../overlay/live'
import { actInDraft, parseActRequest } from '../lcu/draftAct'
import { suggestMetaCounters } from '../data/counters'
import { buildInsights, ROLE_NAMES } from '../data/insights'
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
  const lastPickFile = path.join(userData, 'lastpick.json')
  // Opções de build marcadas na tela (só índices), por campeão e rota: valem para o overlay e para a tela do jogo.
  const lastSelections = new Map<string, BuildSelection>()
  const readLastPick = (): { championId: number; role: Role } | null => {
    try {
      const raw = JSON.parse(readFileSync(lastPickFile, 'utf8')) as { championId?: unknown; role?: unknown; at?: unknown; selection?: unknown }
      const fresh = typeof raw.at === 'number' && Date.now() - raw.at < 6 * 3600_000 // partida de mais de 6 h atrás não vale
      if (fresh && typeof raw.championId === 'number' && raw.championId > 0 && (ROLES as readonly string[]).includes(String(raw.role))) {
        if (raw.selection) lastSelections.set(`${raw.championId}|${String(raw.role)}`, sanitizeSelection(raw.selection))
        return { championId: raw.championId, role: raw.role as Role }
      }
    } catch {
      /* sem arquivo ou ilegível */
    }
    return null
  }
  // Sobrevive ao app fechar e reabrir no meio da partida (o overlay precisa da rota quando o jogo não informa).
  let lastPick: { championId: number; role: Role } | null = readLastPick()
  const saveLastPickFile = (): void => {
    try {
      mkdirSync(path.dirname(lastPickFile), { recursive: true })
      const sel = lastPick ? lastSelections.get(`${lastPick.championId}|${lastPick.role}`) : undefined
      writeFileSync(lastPickFile, JSON.stringify({ ...lastPick, ...(sel ? { selection: sel } : {}), at: Date.now() }))
    } catch {
      /* só conveniência */
    }
  }
  // O último draft visto: depois que o jogo começa o cliente fecha a seleção, mas a build desta partida ainda precisa do confronto e do time inimigo.
  let lastSeenDraft: { draft: DraftState; at: number } | null = null
  const SEEN_MAX_MS = 6 * 3600_000
  let draftEnded = false
  const gameDraft = (): DraftState | null => {
    const live = annotatedDraft()
    if (live) return live
    return lastSeenDraft && Date.now() - lastSeenDraft.at < SEEN_MAX_MS ? lastSeenDraft.draft : null
  }
  const pushDraft = (): void => {
    const d = annotatedDraft()
    if (d) {
      // seleção nova: as opções de build marcadas na partida anterior não valem mais
      if (draftEnded || !lastSeenDraft || Date.now() - lastSeenDraft.at > SEEN_MAX_MS) lastSelections.clear()
      draftEnded = false
      lastSeenDraft = { draft: d, at: Date.now() }
      send(IPC.DRAFT_UPDATE, d)
      const me = d.allies.find((a) => a.cellId === d.localPlayerCellId)
      if (me && me.championId > 0 && d.localRole && (lastPick?.championId !== me.championId || lastPick.role !== d.localRole)) {
        lastPick = { championId: me.championId, role: d.localRole }
        saveLastPickFile()
      }
    }
  }
  lcu.on('draft', pushDraft)
  lcu.on('identity', () => {
    send(IPC.IDENTITY_UPDATE, identityState())
    pushDraft()
  })
  lcu.on('draft-ended', () => {
    draftEnded = true
    send(IPC.DRAFT_ENDED)
  })

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
      `Perfis: ${profiles.list().length}`,
      `Itens reconhecidos para a partida: ${
        Object.keys(itemInfos).length > 0
          ? (() => {
              const c = classifyCatalog(itemInfos)
              return `${c.finals} finais, ${c.antiHeal} anticura, ${c.antiShield} anti-escudo, ${c.shield} com escudo, ${c.tenacity} com tenacidade`
            })()
          : 'catálogo ainda não carregado'
      }`
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
  handle(IPC.META_SYNERGIES, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const ds = meta.get()
    if (!ds || !ROLES.includes(req.roleA as Role) || !ROLES.includes(req.roleB as Role)) return []
    const anchor = typeof req.anchor === 'number' ? req.anchor : undefined
    const anchorRole = ROLES.includes(req.anchorRole as Role) ? (req.anchorRole as Role) : undefined
    return synergyPairs(ds, req.roleA as Role, req.roleB as Role, { anchor, anchorRole, limit: typeof req.limit === 'number' ? Math.min(200, Math.max(1, req.limit)) : undefined })
  })
  handle(IPC.GROUP_ANALYZE, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const ds = meta.get()
    const empty = { pairs: [], suggestions: [], score: null, label: null, best: null, weakest: null }
    if (!ds || ds.isSample || !Array.isArray(req.members)) return empty
    const members: GroupMemberInput[] = []
    for (const m of req.members.slice(0, 5)) {
      if (!isRecord(m) || typeof m.cellId !== 'number' || typeof m.championId !== 'number' || !ROLES.includes(m.role as Role)) continue
      members.push({ cellId: m.cellId, role: m.role as Role, championId: m.championId, tentative: m.tentative === true })
    }
    const unavailable = Array.isArray(req.unavailable) ? req.unavailable.filter((x): x is number => typeof x === 'number').slice(0, 40) : []
    return analyzeGroup(ds, members, unavailable)
  })
  handle(IPC.META_DETAIL, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const ds = meta.get()
    if (!ds || typeof req.championId !== 'number' || !ROLES.includes(req.role as Role)) return null
    return championDetail(ds, req.championId, req.role as Role)
  })
  /** Oponente de rota desta partida (para trocar as runas e feitiços pelos do confronto); null se não é certo. */
  const laneEnemy = (role: Role): number | null => {
    const d = gameDraft()
    const ds = meta.get()
    return d && ds ? laneEnemyOf(d, ds, role) : null
  }
  handle(IPC.META_GET_BUILD, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const role = req.role as Role
    if (typeof req.championId !== 'number' || !ROLES.includes(role)) return null
    const sim = typeof req.enemyId === 'number' && req.enemyId > 0 ? req.enemyId : null
    const base = meta.getBuild(req.championId, role, sim ?? laneEnemy(role))
    // chosen: as opções marcadas na tela de build (a mesma escolha do overlay e da importação)
    return base && req.chosen === true ? applyBuildSelection(base, lastSelections.get(`${req.championId}|${role}`) ?? ZERO_SELECTION) : base
  })
  handle(IPC.BUILD_SELECT, (raw) => {
    const req = isRecord(raw) ? raw : {}
    const role = req.role as Role
    if (typeof req.championId !== 'number' || !ROLES.includes(role)) return
    lastSelections.set(`${req.championId}|${role}`, sanitizeSelection(req.selection))
    if (lastPick && lastPick.championId === req.championId && lastPick.role === role) saveLastPickFile()
  })
  // ---- Confronto de rota: oponente (do draft, ou o simulado pela busca), dupla da bot lane e pontos fortes/fracos
  handle(IPC.DRAFT_MATCHUP, async (raw) => {
    const req = isRecord(raw) ? raw : {}
    const role = req.role as Role
    const empty = { enemyId: null, simulated: false, winrate: null, games: 0, strengths: [], weaknesses: [] }
    const draft = annotatedDraft()
    if (!draft || typeof req.championId !== 'number' || !ROLES.includes(role)) return empty
    await warmChampionKeys()
    const sim = typeof req.enemyId === 'number' && req.enemyId > 0 ? req.enemyId : null
    const me = draft.allies.find((a) => a.cellId === draft.localPlayerCellId)
    return buildInsights({
      dataset: meta.get(),
      draft,
      championId: req.championId,
      role,
      simEnemyId: sim,
      draftEnemyId: laneEnemy(role),
      profile: me?.profileId ? profiles.get(me.profileId) : typeof req.profileId === 'string' ? profiles.get(req.profileId) : undefined,
      nameOf: (id) => champNames.get(id) ?? `Campeão ${id}`,
      roleLabel: (r) => ROLE_NAMES[r]
    })
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
      fallbackProfileId: typeof req.profileId === 'string' ? req.profileId : undefined,
      focusChampionId: typeof req.focusChampionId === 'number' && req.focusChampionId > 0 ? req.focusChampionId : undefined
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
  const keyToId = (key: string): number | null => {
    for (const [id, k] of champKeys) if (k.toLowerCase() === key.toLowerCase()) return id
    return null
  }
  const overlay = new OverlayController(
    {
      getSettings: () => profiles.getSettings(),
      situation: (championId, role, enemyIds) => {
        const draft = { enemies: enemyIds.map((id, i) => ({ cellId: 5 + i, championId: id, status: 'locked', role: null })), allies: [] } as unknown as DraftState
        const base = meta.getBuild(championId, role)
        const chosen = base ? applyBuildSelection(base, lastSelections.get(`${championId}|${role}`) ?? ZERO_SELECTION) : null
        const s = buildSituation({ dataset: meta.get(), draft, build: chosen, championId, role, champions: champInfos, items: itemInfos })
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
      recipes: () => itemInfos,
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
  // ---- Aba Treino: estilo de jogo da conta, concentração da Pool e campeões novos para experimentar (só leitura)
  handle(IPC.COACH_ANALYZE, async (): Promise<CoachResult> => {
    await warmChampionKeys()
    const read = await readAccount((p) => lcu.get(p))
    if (!read.ok) return read
    const ds = meta.get()
    const tiers = ds && !ds.isSample ? Object.fromEntries(ROLES.map((r) => [r, tierRows(ds, r)])) : {}
    const report = analyzeCoach({
      games: read.games,
      mastery: read.mastery,
      champions: champInfos,
      tiers,
      nameOf: (id) => champNames.get(id) ?? `Campeão ${id}`
    })
    return { ok: true, account: read.account, report }
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
    const draft = gameDraft()
    if (!draft || typeof req.championId !== 'number' || !ROLES.includes(role)) return null
    await warmChampionKeys()
    const base = meta.getBuild(req.championId, role)
    return buildSituation({
      dataset: meta.get(),
      draft,
      build: base ? applyBuildSelection(base, lastSelections.get(`${req.championId}|${role}`) ?? ZERO_SELECTION) : null,
      championId: req.championId,
      role,
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
