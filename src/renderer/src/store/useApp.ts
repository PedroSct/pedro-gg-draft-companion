import { create } from 'zustand'
import type { PgDetail, PgSummary } from '../../../shared/postgame'
import type { DraftState, LcuStatus, Role } from '../../../shared/types'
import type {
  AppSettings,
  Catalog,
  ChampionInfo,
  FriendProfile,
  MetaInfo,
  Recommendation,
  RecommendMode,
  UpdateState
} from '../../../shared/dataTypes'
import type { ImportMetaResult, PickDirResult, ProfileInput, UpdateMetaResult } from '../../../shared/api'

interface AppState {
  ready: boolean
  lcuStatus: LcuStatus
  draft: DraftState | null
  profiles: FriendProfile[]
  settings: AppSettings | null
  catalog: Catalog | null
  catalogError: string | null
  champById: Map<number, ChampionInfo>
  metaInfo: MetaInfo | null
  recommendation: Recommendation | null
  /** Rota escolhida à mão quando a fila não atribui posição (blind pick, normal). */
  roleOverride: Role | null
  /** Campeão da lista de alternativas que o usuário clicou para ver a build. */
  previewChampionId: number | null
  poolOpen: boolean
  settingsOpen: boolean
  /** estado da atualização do app (null até o main responder) */
  update: UpdateState | null
  /** versão nova que a pessoa mandou "deixar para depois" (não mostra o aviso de novo até mudar) */
  updateDismissed: string | null
  /** quando o app aceitou a última partida sozinho (para o aviso rápido no topo) */
  autoAcceptedAt: number | null

  /** tela principal: seleção de campeões ou análise das partidas */
  view: 'draft' | 'postgame'
  postList: PgSummary[]
  postSelectedId: number | null
  postDetail: PgDetail | null
  postBusy: boolean
  postMessage: { ok: boolean; text: string } | null

  setView: (view: 'draft' | 'postgame') => void
  loadPostGames: (selectLatest?: boolean) => Promise<void>
  selectPostGame: (gameId: number) => Promise<void>
  fetchLatestPostGame: () => Promise<void>
  deletePostGame: (gameId: number) => Promise<void>

  init: () => Promise<() => void>
  loadCatalog: () => Promise<void>
  refreshRecommendation: () => Promise<void>
  setActiveProfile: (id: string) => Promise<void>
  setRoleOverride: (role: Role | null) => void
  setPreview: (championId: number | null) => void
  saveProfile: (input: ProfileInput) => Promise<FriendProfile>
  deleteProfile: (id: string) => Promise<void>
  pickGameDir: () => Promise<PickDirResult>
  resetGameDir: () => Promise<void>
  importMeta: () => Promise<ImportMetaResult>
  updateMeta: () => Promise<UpdateMetaResult>
  /** Salva só as chaves enviadas; lança se o main recusar o valor. */
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  openPool: () => void
  closePool: () => void
  openSettings: () => void
  closeSettings: () => void
  setPickMode: (mode: RecommendMode) => Promise<void>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  dismissUpdate: () => void
}

const CATALOG_ERROR =
  'Não foi possível carregar os ícones e dados do jogo. Conecte à internet uma vez para o app guardar uma cópia.'

const localChampion = (d: DraftState | null): number =>
  d?.allies.find((p) => p.cellId === d.localPlayerCellId)?.championId ?? 0

/** Perfil em uso: o último escolhido, ou o primeiro da lista. */
export const selectActiveProfile = (s: AppState): FriendProfile | null =>
  s.profiles.find((p) => p.id === s.settings?.lastActiveProfileId) ?? s.profiles[0] ?? null

let recSeq = 0 // descarta respostas antigas quando o draft muda rápido

export const useApp = create<AppState>()((set, get) => ({
  ready: false,
  lcuStatus: 'searching',
  draft: null,
  profiles: [],
  settings: null,
  catalog: null,
  catalogError: null,
  champById: new Map(),
  metaInfo: null,
  recommendation: null,
  roleOverride: null,
  previewChampionId: null,
  poolOpen: false,
  settingsOpen: false,
  update: null,
  updateDismissed: null,
  autoAcceptedAt: null,
  view: 'draft',
  postList: [],
  postSelectedId: null,
  postDetail: null,
  postBusy: false,
  postMessage: null,

  setView: (view) => set({ view }),

  loadPostGames: async (selectLatest = false) => {
    const postList = await window.api.listPostGames()
    set({ postList })
    const cur = get().postSelectedId
    const target = selectLatest || cur === null || !postList.some((p) => p.gameId === cur) ? (postList[0]?.gameId ?? null) : cur
    if (target === null) set({ postSelectedId: null, postDetail: null })
    else if (target !== cur || selectLatest || get().postDetail === null) await get().selectPostGame(target)
  },

  selectPostGame: async (gameId) => {
    set({ postSelectedId: gameId })
    const detail = await window.api.getPostGame(gameId)
    if (get().postSelectedId === gameId) set({ postDetail: detail })
  },

  fetchLatestPostGame: async () => {
    set({ postBusy: true, postMessage: null })
    try {
      const res = await window.api.fetchLatestPostGame()
      set({ postMessage: { ok: res.ok, text: res.message } })
      if (res.ok) await get().loadPostGames(true)
    } catch {
      set({ postMessage: { ok: false, text: 'Não consegui buscar a partida. Tente de novo.' } })
    } finally {
      set({ postBusy: false })
    }
  },

  deletePostGame: async (gameId) => {
    await window.api.deletePostGame(gameId)
    await get().loadPostGames()
  },

  init: async () => {
    const api = window.api
    const [lcuStatus, draft, profiles, settings, metaInfo] = await Promise.all([
      api.getLcuStatus(),
      api.getCurrentDraft(),
      api.listProfiles(),
      api.getSettings(),
      api.getMetaInfo()
    ])
    set({ lcuStatus, draft, profiles, settings, metaInfo, ready: true })
    void get().loadCatalog()
    void get().refreshRecommendation()

    const offs = [
      api.onLcuStatus((status) => {
        set({ lcuStatus: status })
        // Conectou: a versão do patch do cliente já é conhecida, então revalida o catálogo (cache local).
        if (status === 'connected') void get().loadCatalog()
      }),
      api.onDraftUpdate((next) => {
        if (!get().draft) set({ view: 'draft' }) // começou uma seleção: volta para ela
        const pickChanged = localChampion(get().draft) !== localChampion(next)
        set({ draft: next, ...(pickChanged ? { previewChampionId: null } : {}) })
        void get().refreshRecommendation()
      }),
      api.onDraftEnded(() => {
        recSeq++
        set({ draft: null, recommendation: null, previewChampionId: null, roleOverride: null })
      }),
      // Meta atualizado em segundo plano: mostra os dados novos e recalcula a sugestão.
      api.onMetaUpdated((info) => {
        set({ metaInfo: info })
        void get().refreshRecommendation()
      }),
      api.onUpdateState((update) => set({ update })),
      api.onAutoAccepted(() => set({ autoAcceptedAt: Date.now() })),
      // Terminou uma partida: mostra a análise assim que ficar pronta.
      api.onPostGameReady(() => {
        set({ view: 'postgame', postMessage: null })
        void get().loadPostGames(true)
      })
    ]
    void get().loadPostGames()
    void api.getUpdateState().then((update) => set((s) => (s.update ? s : { update })))
    // Fecha a janela em que a atualização terminou entre a leitura inicial e o registro do listener.
    void api.getMetaInfo().then((info) => set({ metaInfo: info }))
    return () => offs.forEach((off) => off())
  },

  loadCatalog: async () => {
    try {
      const catalog = await window.api.getCatalog()
      set({ catalog, catalogError: null, champById: new Map(catalog.champions.map((c) => [c.id, c])) })
    } catch {
      if (!get().catalog) set({ catalogError: CATALOG_ERROR })
    }
  },

  refreshRecommendation: async () => {
    const state = get()
    const profile = selectActiveProfile(state)
    if (!state.draft || !profile) {
      recSeq++
      set({ recommendation: null })
      return
    }
    const mine = ++recSeq
    const recommendation = await window.api.recommend({ profileId: profile.id, role: state.roleOverride })
    if (mine === recSeq) set({ recommendation })
  },

  setActiveProfile: async (id) => {
    const settings = await window.api.setSettings({ lastActiveProfileId: id })
    set({ settings, previewChampionId: null })
    await get().refreshRecommendation()
  },

  setRoleOverride: (roleOverride) => {
    set({ roleOverride, previewChampionId: null })
    void get().refreshRecommendation()
  },

  setPreview: (previewChampionId) => set({ previewChampionId }),

  saveProfile: async (input) => {
    const saved = await window.api.saveProfile(input)
    const [profiles, settings] = await Promise.all([window.api.listProfiles(), window.api.getSettings()])
    set({ profiles, settings })
    await get().refreshRecommendation()
    return saved
  },

  deleteProfile: async (id) => {
    await window.api.deleteProfile(id)
    const [profiles, settings] = await Promise.all([window.api.listProfiles(), window.api.getSettings()])
    set({ profiles, settings })
    await get().refreshRecommendation()
  },

  pickGameDir: async () => {
    const result = await window.api.pickGameDir()
    if (result.ok) set({ settings: await window.api.getSettings() })
    return result
  },

  resetGameDir: async () => {
    set({ settings: await window.api.setSettings({ lockfilePath: null }) })
  },

  importMeta: async () => {
    const result = await window.api.importMeta()
    if (result.ok) {
      set({ metaInfo: result.info })
      await get().refreshRecommendation()
    }
    return result
  },

  updateMeta: async () => {
    const result = await window.api.updateMeta()
    if (result.ok) {
      set({ metaInfo: result.info })
      await get().refreshRecommendation()
    }
    return result
  },

  saveSettings: async (patch) => {
    set({ settings: await window.api.setSettings(patch) })
  },

  setPickMode: async (pickMode) => {
    set({ settings: await window.api.setSettings({ pickMode }) })
    await get().refreshRecommendation()
  },

  checkForUpdates: async () => set({ update: await window.api.checkForUpdates(), updateDismissed: null }),
  downloadUpdate: async () => set({ update: await window.api.downloadUpdate() }),
  installUpdate: async () => {
    await window.api.installUpdate()
  },
  dismissUpdate: () => set((s) => ({ updateDismissed: s.update?.latest ?? null })),

  openPool: () => set({ poolOpen: true }),
  closePool: () => set({ poolOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false })
}))
