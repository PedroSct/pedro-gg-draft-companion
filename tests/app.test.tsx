import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import { useApp } from '../src/renderer/src/store/useApp'
import { recommend } from '../src/main/data/recommender'
import { validateDataset } from '../src/main/data/meta'
import { championDetail, tierRows } from '../src/main/data/metaStats'
import type { DraftPlayer, DraftState, LcuStatus } from '../src/shared/types'
import type { AppSettings, BuildSituation, Catalog, FriendProfile, UpdateState } from '../src/shared/dataTypes'
import type { DecodeResult } from '../src/shared/poolShare'
import type { IdentityState, LolApi, ProfileInput } from '../src/shared/api'
import type { CoachResult } from '../src/shared/coach'
import { analyzeMatch, summarize, type PgDetail, type PgSummary } from '../src/shared/postgame'
import { normalizeMatch } from '../src/main/postgame/normalize'
import { makeLcuMatch } from './fixtures/match'

const dataset = validateDataset(JSON.parse(readFileSync(join(process.cwd(), 'resources', 'meta.sample.json'), 'utf8')))

const NAMES: [number, string, string, string[]][] = [
  [103, 'Ahri', 'Ahri', ['Mage', 'Assassin']],
  [134, 'Syndra', 'Syndra', ['Mage']],
  [61, 'Orianna', 'Orianna', ['Mage', 'Support']],
  [157, 'Yasuo', 'Yasuo', ['Fighter', 'Assassin']],
  [238, 'Zed', 'Zed', ['Assassin']],
  [86, 'Garen', 'Garen', ['Fighter', 'Tank']],
  [89, 'Leona', 'Leona', ['Tank', 'Support']]
]

const catalog: Catalog = {
  version: '16.20.1',
  locale: 'pt_BR',
  champions: NAMES.map(([id, key, name, tags]) => ({ id, key, name, iconUrl: `https://img.test/${key}.png`, tags })),
  items: {}
}

const makeProfile = (): FriendProfile => ({
  id: 'p1',
  nickname: 'Pedro',
  mainRoles: ['MIDDLE'],
  createdAt: '2026-10-27T00:00:00Z',
  updatedAt: '2026-10-27T00:00:00Z',
  pool: {
    TOP: [],
    JUNGLE: [],
    BOTTOM: [],
    UTILITY: [],
    MIDDLE: [
      { championId: 103, championKey: 'Ahri', comfort: 4 },
      { championId: 157, championKey: 'Yasuo', comfort: 2 },
      { championId: 134, championKey: 'Syndra', comfort: 5 },
      { championId: 61, championKey: 'Orianna', comfort: 3 }
    ]
  }
})

const player = (cellId: number, championId: number, status: DraftPlayer['status'], role: DraftPlayer['role'] = null): DraftPlayer => ({
  cellId,
  championId,
  status,
  role
})

const draftWithZed = (): DraftState => ({
  phase: 'BAN_PICK',
  localPlayerCellId: 1,
  localRole: 'MIDDLE',
  allies: [player(0, 0, 'none', 'TOP'), player(1, 0, 'none', 'MIDDLE')],
  enemies: [player(5, 238, 'locked')],
  bans: { allies: [], enemies: [] }
})

interface Fake {
  api: LolApi
  pushUpdate(u: UpdateState): void
  draftAct: ReturnType<typeof vi.fn>
  pushGameflow(p: string): void
  setSituation(s: BuildSituation | null): void
  installUpdate: ReturnType<typeof vi.fn>
  decodeShare: ReturnType<typeof vi.fn>
  copyText: ReturnType<typeof vi.fn>
  pushStatus(s: LcuStatus): void
  pushDraft(d: DraftState): void
  endDraft(): void
  saveProfile: ReturnType<typeof vi.fn>
}

function postGameFixture(): { summary: PgSummary; detail: PgDetail } {
  const report = normalizeMatch(makeLcuMatch())!
  const analysis = analyzeMatch(report)!
  return { summary: summarize(report, analysis, 1_761_700_000_000), detail: { report, analysis } }
}

function installApi(opts: { profiles?: FriendProfile[]; postGames?: { summary: PgSummary; detail: PgDetail }[]; metaPatch?: string; tourDone?: boolean; coach?: CoachResult } = {}): Fake {
  let profiles = opts.profiles ?? [makeProfile()]
  let draft: DraftState | null = null
  let status: LcuStatus = 'connected'
  let settings: AppSettings = {
    lockfilePath: null,
    ddragonVersion: 'auto',
    locale: 'pt_BR',
    lastActiveProfileId: profiles[0]?.id ?? null,
    metaUrl: null,
    metaAutoUpdate: true,
    metaRegion: 'global',
    tourDone: opts.tourDone ?? true,
    pickMode: 'balanced',
    autoAccept: false,
    autoAcceptDelay: 1,
    introAnimation: true,
    reduceMotion: false,
    overlayEnabled: false,
    overlayCorner: 'tr',
    overlayOpacity: 0.9,
    overlayCompact: false,
    overlayKeySize: 'CommandOrControl+Shift+F9',
    overlayKeyMove: 'CommandOrControl+Shift+F10',
    overlayPos: null
  }
  let identity: IdentityState = { account: null, profileId: null }
  let situation: BuildSituation | null = null
  let update: UpdateState = { status: 'idle', current: '0.1.0' }
  const updateCbs = new Set<(s: UpdateState) => void>()
  const setUpdate = (u: UpdateState): UpdateState => {
    update = u
    updateCbs.forEach((cb) => cb(u))
    return u
  }
  const statusCbs = new Set<(s: LcuStatus) => void>()
  const draftCbs = new Set<(d: DraftState) => void>()
  const endedCbs = new Set<() => void>()

  const saveProfile = vi.fn(async (input: ProfileInput): Promise<FriendProfile> => {
    const saved = { ...makeProfile(), ...input, id: input.id ?? 'p-new', createdAt: 'x', updatedAt: 'y' } as FriendProfile
    profiles = profiles.some((p) => p.id === saved.id) ? profiles.map((p) => (p.id === saved.id ? saved : p)) : [...profiles, saved]
    if (!settings.lastActiveProfileId) settings = { ...settings, lastActiveProfileId: saved.id }
    return saved
  })

  const installUpdate = vi.fn(async () => true)
  const decodeShare = vi.fn(async (_text: string): Promise<DecodeResult> => ({ ok: false, message: 'Não reconheci isso como uma Pool do Pedro.gg.' }))
  const copyText = vi.fn(async (_text: string) => {})
  const draftAct = vi.fn(async (_req: { kind: 'hover' | 'lock'; type: 'pick' | 'ban'; championId: number }) => ({ ok: true, message: 'Feito.' }))
  const gameflowCbs = new Set<(p: string) => void>()
  let gameflow: string | null = null

  const api: LolApi = {
    onMetaUpdated: () => () => {},
    onAutoAccepted: () => () => {},
    getDiagnostics: async () => 'diagnóstico de teste',
    getLastAccept: async () => null,
    getMetaCounters: async () => [],
    getOverlayState: async () => null,
    onOverlayState: () => () => {},
    previewOverlay: async () => false,
    suggestPoolFromAccount: async () => ({ ok: false as const, message: 'sem cliente' }),
    analyzeCoach: async () => opts.coach ?? { ok: false as const, message: 'sem cliente' },
    startOverlayMove: async () => false,
    finishOverlayMove: async () => undefined,
    exportBackup: async () => ({ ok: false, reason: 'canceled' }),
    importBackup: async () => ({ ok: false, reason: 'canceled' }),
    getPatchChanges: async () => null,
    ackPatchChanges: async () => undefined,
    saveDiagnostics: async () => ({ ok: false }),
    probeClient: async () => [],
    onPostGameReady: () => () => {},
    listPostGames: async () => (opts.postGames ?? []).map((g) => g.summary),
    getPostGame: async (id) => opts.postGames?.find((g) => g.summary.gameId === id)?.detail ?? null,
    deletePostGame: async () => true,
    fetchLatestPostGame: async () => ({ ok: false, message: 'sem partidas' }),
    applyLoadout: async () => ({ ok: true, parts: { runes: { ok: true, message: 'Runas aplicadas.' } } }),
    onIdentity: () => () => {},
    getIdentity: async () => identity,
    claimProfile: async (id) => {
      identity = { account: identity.account, profileId: id }
      return identity
    },
    onUpdateState: (cb) => (updateCbs.add(cb), () => updateCbs.delete(cb)),
    getUpdateState: async () => update,
    checkForUpdates: async () => update,
    downloadUpdate: async () => setUpdate({ ...update, status: 'ready' }),
    installUpdate,
    encodeShare: async () => 'PGG1:codigo-de-teste',
    decodeShare,
    exportShareFile: async () => ({ ok: true, path: '/tmp/x.json' }),
    importShareFile: async () => ({ ok: false, reason: 'canceled' }),
    copyText,
    readClipboardText: async () => 'PGG1:colado',
    onLcuStatus: (cb) => (statusCbs.add(cb), () => statusCbs.delete(cb)),
    onDraftUpdate: (cb) => (draftCbs.add(cb), () => draftCbs.delete(cb)),
    onDraftEnded: (cb) => (endedCbs.add(cb), () => endedCbs.delete(cb)),
    getLcuStatus: async () => status,
    getCurrentDraft: async () => draft,
    recommend: async (req) => {
      const profile = profiles.find((p) => p.id === req.profileId)
      if (!profile || !draft) return null
      let d = draft
      if (typeof req.cellId === 'number') {
        const who = draft.allies.find((a) => a.cellId === req.cellId)
        if (!who) return null
        d = { ...draft, localPlayerCellId: who.cellId, localRole: who.role }
      }
      return recommend({ draft: d, profile, dataset, role: req.role, mode: settings.pickMode })
    },
    getSettings: async () => settings,
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    pickGameDir: async () => ({ ok: false, reason: 'canceled' }),
    listProfiles: async () => structuredClone(profiles),
    saveProfile,
    deleteProfile: async (id) => {
      profiles = profiles.filter((p) => p.id !== id)
      return true
    },
    getCatalog: async () => catalog,
    getSpells: async () => [],
    getMetaInfo: async () =>
      opts.metaPatch
        ? { source: 'https://x.test/meta.json', patch: opts.metaPatch, generatedAt: '', isSample: false, champions: 7 }
        : { source: 'sample', patch: 'sample', generatedAt: '', isSample: true, champions: 7 },
    getMetaTiers: async (role) => tierRows(dataset, role),
    getAccountStats: async () => ({ level: 312, tier: 'GOLD', division: 'II', lp: 45, wins: 52, losses: 48 }),
    getMetaDetail: async ({ championId, role }) => championDetail(dataset, championId, role),
    getBuildSituation: async () => situation,
    getBanSuggestions: async () => [],
    draftAct,
    getGameflow: async () => gameflow,
    onGameflow: (cb) => (gameflowCbs.add(cb), () => gameflowCbs.delete(cb)),
    getBuild: async ({ championId, role }) => dataset.champions[String(championId)]?.roles[role]?.build ?? null,
    importMeta: async () => ({ ok: false, reason: 'canceled' }),
    updateMeta: async () => ({ ok: false, reason: 'no-url' })
  }
  window.api = api

  return {
    api,
    saveProfile,
    installUpdate,
    decodeShare,
    copyText,
    draftAct,
    pushGameflow: (p: string) => {
      gameflow = p
      gameflowCbs.forEach((cb) => cb(p))
    },
    pushUpdate: (u) => act(() => void setUpdate(u)),
    setSituation: (s) => {
      situation = s
    },
    pushStatus: (s) => {
      status = s
      statusCbs.forEach((cb) => cb(s))
    },
    pushDraft: (d) => {
      draft = d
      draftCbs.forEach((cb) => cb(d))
    },
    endDraft: () => {
      draft = null
      endedCbs.forEach((cb) => cb())
    }
  }
}

beforeEach(() => {
  useApp.setState({
    ready: false,
    lcuStatus: 'searching',
    draft: null,
    gameflow: null,
    lastPick: null,
    profiles: [],
    settings: null,
    catalog: null,
    catalogError: null,
    champById: new Map(),
    metaInfo: null,
    recommendation: null,
    recs: {},
    identity: null,
    focusCellId: null,
    friendRoles: {},
    roleOverride: null,
    previewChampionId: null,
    poolDirty: false,
    tourOpen: false,
    settingsOpen: false,
    update: null,
    updateDismissed: null,
    view: 'draft',
    postList: [],
    postSelectedId: null,
    postDetail: null,
    postBusy: false,
    postMessage: null
  })
})

describe('Companion App', () => {
  it('mostra a tela de espera quando não há draft e avisa que os dados são de amostra', async () => {
    installApi()
    render(<App />)
    expect(await screen.findByText('Conectado. Entre em uma fila.')).toBeInTheDocument()
    expect(screen.getByText(/dados de amostra \(poucos campeões\), que não refletem o meta real/)).toBeInTheDocument()
  })

  it('sem perfis, convida a criar o primeiro', async () => {
    installApi({ profiles: [] })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Criar o primeiro perfil' })).toBeInTheDocument()
  })

  it('quando o draft chega, destaca o melhor pick da Pool e lista as alternativas', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')

    act(() => fake.pushDraft(draftWithZed()))

    const verdict = await screen.findByTestId('verdict')
    expect(verdict).toHaveTextContent('Orianna') // mesmo ranking do Módulo 3: [61, 134, 103, 157]
    expect(verdict).toHaveTextContent('Melhor pick da sua Pool')

    const alts = screen.getByRole('list', { name: 'Outras opções da Pool' })
    const names = within(alts)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
    expect(names).toHaveLength(3)
    expect(names[0]).toContain('Syndra')
    expect(names[1]).toContain('Ahri')
    expect(names[2]).toContain('Yasuo')

    // O time inimigo mostra o Zed travado
    expect(screen.getByRole('list', { name: 'Time inimigo' })).toHaveTextContent('Zed')
  })

  it('clicar em uma alternativa mostra a build e a ordem das habilidades dela', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    const alts = await screen.findByRole('list', { name: 'Outras opções da Pool' })

    await user.click(within(alts).getByRole('button', { name: /Ahri/ }))

    const build = await screen.findByRole('region', { name: 'Build' })
    expect(await within(build).findByRole('img', { name: 'R > Q > E > W' })).toBeInTheDocument()
    expect(within(build).getByText('Opção selecionada, Meio')).toBeInTheDocument()
    expect(within(build).getByText('contra assassinos (Zed, Akali)')).toBeInTheDocument()
  })

  it('quando o jogador trava um campeão, a build passa a ser a dele', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    const locked = draftWithZed()
    locked.allies[1] = player(1, 103, 'locked', 'MIDDLE')
    act(() => fake.pushDraft(locked))

    const build = await screen.findByRole('region', { name: 'Build' })
    expect(await within(build).findByText('Seu campeão, Meio')).toBeInTheDocument()
    expect(await within(build).findByRole('img', { name: 'R > Q > E > W' })).toBeInTheDocument()
    // pick travado: as sugestões somem e fica só o campeão escolhido
    const lockedCard = screen.getByRole('region', { name: 'Pick travado' })
    expect(within(lockedCard).getByText('Ahri')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Outras opções da Pool' })).not.toBeInTheDocument()
    expect(screen.queryByText('Melhor pick da sua Pool')).not.toBeInTheDocument()
  })

  it('sem rota atribuída, pede a rota e recomenda depois da escolha', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    const blind = draftWithZed()
    blind.localRole = null
    blind.allies = [player(0, 0, 'none'), player(1, 0, 'none')]
    act(() => fake.pushDraft(blind))

    const group = await screen.findByRole('group', { name: 'Rota que você vai jogar' })
    await user.click(within(group).getByRole('button', { name: /^Mid/ }))

    expect(await screen.findByTestId('verdict')).toHaveTextContent('Orianna')
  })

  it('reconhece o amigo na seleção e mostra as sugestões dele', async () => {
    const user = userEvent.setup()
    const friend: FriendProfile = {
      ...makeProfile(),
      id: 'p2',
      nickname: 'Caio',
      riotId: 'Caio#BR1',
      mainRoles: ['TOP'],
      pool: { ...makeProfile().pool, MIDDLE: [], TOP: [{ championId: 86, championKey: 'Garen', comfort: 5 }] }
    }
    const fake = installApi({ profiles: [makeProfile(), friend] })
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    const d = draftWithZed()
    d.allies[0] = { ...player(0, 0, 'none', 'TOP'), name: 'Caio#BR1', profileId: 'p2' }
    d.allies[1] = { ...player(1, 0, 'none', 'MIDDLE'), isMe: true }
    act(() => fake.pushDraft(d))

    expect(await screen.findByTestId('verdict')).toHaveTextContent('Orianna')
    const group = screen.getByRole('group', { name: 'Para quem são as sugestões' })
    await user.click(within(group).getByRole('button', { name: /Caio/ }))

    const verdict = await screen.findByTestId('verdict')
    await waitFor(() => expect(verdict).toHaveTextContent('Melhor pick de Caio'))
    expect(verdict).toHaveTextContent('Garen')

    // Voltar para você
    await user.click(within(group).getByRole('button', { name: /Você/ }))
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveTextContent('Melhor pick da sua Pool'))
  })

  it('importa runas, feitiços e itens só quando a pessoa clica, e mostra o resultado', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    const apply = vi.spyOn(fake.api, 'applyLoadout')
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    const locked = draftWithZed()
    locked.allies[1] = player(1, 103, 'locked', 'MIDDLE')
    act(() => fake.pushDraft(locked))

    const panel = await screen.findByRole('region', { name: 'Importar para o cliente' })
    expect(apply).not.toHaveBeenCalled()
    expect(within(panel).getByRole('checkbox', { name: /Itens/ })).not.toBeChecked() // itens: só se a pessoa marcar
    await user.click(within(panel).getByRole('button', { name: 'Importar para o cliente' }))

    await waitFor(() => expect(apply).toHaveBeenCalledWith({
        championId: 103,
        role: 'MIDDLE',
        parts: { runes: true, spells: true, items: false },
        selection: { runes: 0, spells: 0, starting: 0, boots: 0, core: 0 }
      }))
    expect(await within(panel).findByText(/Runas: Runas aplicadas/)).toBeInTheDocument()
  })

  it('o conjunto de itens só é enviado quando a pessoa marca "Itens"', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    const apply = vi.spyOn(fake.api, 'applyLoadout')
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    const locked = draftWithZed()
    locked.allies[1] = player(1, 103, 'locked', 'MIDDLE')
    act(() => fake.pushDraft(locked))
    const panel = await screen.findByRole('region', { name: 'Importar para o cliente' })
    await user.click(within(panel).getByRole('checkbox', { name: /Itens/ }))
    await user.click(within(panel).getByRole('button', { name: 'Importar para o cliente' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({ parts: { runes: true, spells: true, items: true } })))
  })

  it('mostra o painel "Para esta partida" com o foco da build e o motivo da composição', async () => {
    const fake = installApi()
    fake.setSituation({
      enemiesKnown: 3,
      enemyDamage: { physical: 0.8, magic: 0.2 },
      tankyEnemies: 0,
      focus: 'armor',
      picks: [{ itemId: 3089, reason: 'armor' }],
      variantCore: null
    })
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    const locked = draftWithZed()
    locked.allies[1] = player(1, 103, 'locked', 'MIDDLE')
    act(() => fake.pushDraft(locked))

    const panel = await screen.findByRole('region', { name: 'Para esta partida' })
    expect(within(panel).getByText(/priorize armadura/)).toBeInTheDocument()
    expect(within(panel).getByText(/3 de 5 inimigos conhecidos/)).toBeInTheDocument()
    expect(within(panel).getByText(/Boa aqui: armadura/)).toBeInTheDocument()
  })

  it('a aba Meta mostra o ranking da rota e o detalhe do campeão', async () => {
    const user = userEvent.setup()
    installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    await user.click(screen.getByRole('tab', { name: 'Meta' }))

    const list = await screen.findByRole('list', { name: 'Ranking de Meio' })
    expect(within(list).getAllByRole('button').length).toBeGreaterThan(1)
    const first = within(list).getAllByRole('button')[0]
    await user.click(first)
    const detail = await screen.findByRole('region', { name: /Detalhes de/ })
    expect(within(detail).getByText('Vai melhor contra')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Suporte' }))
    expect(await screen.findByText(/não têm campeões para esta rota/)).toBeInTheDocument()
  })

  it('a aba Meta ordena pelos cabeçalhos e filtra por tier', async () => {
    const user = userEvent.setup()
    installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    await user.click(screen.getByRole('tab', { name: 'Meta' }))
    const list = await screen.findByRole('list', { name: 'Ranking de Meio' })
    const names = (): string[] => within(list).getAllByRole('button').map((b) => b.textContent ?? '')
    const total = names().length
    expect(total).toBeGreaterThan(1)

    const games = screen.getByRole('button', { name: 'Ordenar por Jogos' })
    expect(games).toHaveAttribute('aria-sort', 'none')
    await user.click(games)
    expect(games).toHaveAttribute('aria-sort', 'descending')
    await user.click(games)
    expect(games).toHaveAttribute('aria-sort', 'ascending')
    const ascending = names()
    await user.click(games)
    expect(names()).not.toEqual(ascending)

    expect(screen.getByText(`${total} de ${total}`)).toBeInTheDocument()
    const s = screen.getByRole('button', { name: 'S' })
    await user.click(s)
    expect(s).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(s).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(`${total} de ${total}`)).toBeInTheDocument()
  })

  it('mostra as sugestões de banimento durante os bans e deixa ocultar', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    ;(fake.api as { getBanSuggestions: LolApi['getBanSuggestions'] }).getBanSuggestions = async () => [
      { championId: 238, score: 3, reasons: [{ kind: 'counter', championId: 103, nickname: 'Pedro', role: 'MIDDLE', winrate: 0.62, games: 40 }] },
      { championId: 86, score: 1, reasons: [{ kind: 'meta', role: 'TOP', tier: 'S', winrate: 0.54, games: 900 }] }
    ]
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))

    const panel = await screen.findByRole('region', { name: 'Sugestões de banimento' })
    expect(within(panel).getByText(/Atrapalha Ahri de Pedro/)).toBeInTheDocument()
    expect(within(panel).getByText(/tier S/)).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: /Sugestões de banimento/ }))
    expect(within(panel).queryByText(/Atrapalha Ahri/)).not.toBeInTheDocument()
  })

  it('enxuga os bans: mostra 3 sugestões de uma linha e abre o resto sob demanda', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    ;(fake.api as { getBanSuggestions: LolApi['getBanSuggestions'] }).getBanSuggestions = async () =>
      [238, 86, 157, 64, 103].map((id) => ({
        championId: id,
        score: 1,
        reasons: [
          { kind: 'meta' as const, role: 'TOP' as const, tier: 'S' as const, winrate: 0.54, games: 900 },
          { kind: 'counter' as const, championId: 103, nickname: 'Pedro', role: 'MIDDLE' as const, winrate: 0.6, games: 30 }
        ]
      }))
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    const panel = await screen.findByRole('region', { name: 'Sugestões de banimento' })
    expect(within(panel).getAllByText(/Meta de Top: tier S/)).toHaveLength(3)
    expect(within(panel).queryByText(/vence 60,0%/)).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Ver mais 2' }))
    expect(within(panel).getAllByText(/Meta de Top: tier S/)).toHaveLength(5)
    await user.click(within(panel).getAllByRole('button', { name: /^Detalhes de/ })[0])
    expect(within(panel).getByText(/vence 60,0%/)).toBeInTheDocument()
  })

  it('só oferece banir e escolher na vez da pessoa', async () => {
    const fake = installApi()
    ;(fake.api as { getBanSuggestions: LolApi['getBanSuggestions'] }).getBanSuggestions = async () => [
      { championId: 238, score: 3, reasons: [{ kind: 'meta', role: 'TOP', tier: 'S', winrate: 0.54, games: 900 }] }
    ]
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    await screen.findByRole('region', { name: 'Sugestões de banimento' })
    expect(screen.queryByRole('button', { name: /^Banir/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Travar/ })).not.toBeInTheDocument()
  })

  it('bane pelo app só depois de confirmar', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    ;(fake.api as { getBanSuggestions: LolApi['getBanSuggestions'] }).getBanSuggestions = async () => [
      { championId: 238, score: 3, reasons: [{ kind: 'meta', role: 'TOP', tier: 'S', winrate: 0.54, games: 900 }] }
    ]
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft({ ...draftWithZed(), turn: { id: 3, type: 'ban', championId: 0 } }))
    await user.click(await screen.findByRole('button', { name: /^Banir/ }))
    expect(fake.draftAct).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(fake.draftAct).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /^Banir/ }))
    await user.click(screen.getByRole('button', { name: 'Sim, banir' }))
    expect(fake.draftAct).toHaveBeenCalledWith({ kind: 'lock', type: 'ban', championId: 238 })
    expect(await screen.findByText('Feito.')).toBeInTheDocument()
  })

  it('escolhe pelo app: seleciona e só trava depois de confirmar', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft({ ...draftWithZed(), turn: { id: 7, type: 'pick', championId: 0 } }))
    await screen.findByTestId('verdict')
    await user.click(await screen.findByRole('button', { name: /^Selecionar Orianna/ }))
    expect(fake.draftAct).toHaveBeenLastCalledWith({ kind: 'hover', type: 'pick', championId: 61 })
    await user.click(screen.getByRole('button', { name: 'Travar Orianna' }))
    expect(fake.draftAct).toHaveBeenCalledTimes(1) // ainda pediu confirmação
    await user.click(screen.getByRole('button', { name: 'Sim, travar' }))
    expect(fake.draftAct).toHaveBeenLastCalledWith({ kind: 'lock', type: 'pick', championId: 61 })
  })

  it('mostra o Plano de jogo ao travar e depois, com a partida rolando, na tela principal', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft({ ...draftWithZed(), allies: [player(0, 0, 'none', 'TOP'), player(1, 103, 'locked', 'MIDDLE')] }))
    const plan = await screen.findByRole('region', { name: 'Plano de jogo' })
    expect(within(plan).getByRole('listitem', { name: 'Início' })).toBeInTheDocument()
    expect(within(plan).getByRole('listitem', { name: 'Meio' })).toBeInTheDocument()
    expect(within(plan).getByRole('listitem', { name: 'Fim' })).toBeInTheDocument()

    act(() => fake.endDraft())
    expect(await screen.findByText('Conectado. Entre em uma fila.')).toBeInTheDocument()
    act(() => fake.pushGameflow('InProgress'))
    const inGame = await screen.findByRole('region', { name: 'Plano de jogo' })
    expect(inGame).toHaveTextContent('Ahri')
    expect(screen.queryByText('Conectado. Entre em uma fila.')).not.toBeInTheDocument()

    act(() => fake.pushGameflow('EndOfGame'))
    expect(await screen.findByText('Conectado. Entre em uma fila.')).toBeInTheDocument()
  })

  it('a busca do Meta tem um X que limpa o texto e volta o foco para o campo', async () => {
    const user = userEvent.setup()
    installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    await user.click(screen.getByRole('tab', { name: 'Meta' }))
    const search = await screen.findByRole('textbox', { name: 'Buscar campeão no ranking' })
    expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument()
    await user.type(search, 'zed')
    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument()
  })

  it('aba Treino: mostra o alerta de one-trick, as sugestões e deixa adicionar à Pool', async () => {
    const user = userEvent.setup()
    const coach: CoachResult = {
      ok: true,
      account: 'Amigo#BR1',
      report: {
        gamesUsed: 20,
        distinct: 2,
        top: [{ championId: 103, games: 16, wins: 7, share: 0.8 }],
        oneTrick: { championId: 103, games: 16, wins: 7, share: 0.8 },
        concentration: 'high',
        roles: [{ role: 'MIDDLE', games: 20, share: 1 }],
        mainRole: 'MIDDLE',
        style: { label: 'Mago: dano e controle à distância com habilidades', tags: [{ tag: 'Mage', share: 1 }] },
        level: 'regular',
        suggestions: [{ championId: 134, role: 'MIDDLE', tier: 'S', winrate: 0.53, metaGames: 5000, difficulty: 6, similarity: 0.9, similarTo: 103, sharedTags: ['Mage'], reasons: ['Joga parecido com Ahri: mesma classe (Mago).', '53% de vitórias na rota, tier S.'] }],
        tips: [{ level: 'warn', title: '80% das suas partidas foram de Ahri', detail: 'Treine 2 ou 3 campeões parecidos.', championId: 103 }]
      }
    }
    installApi({ coach })
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    await user.click(screen.getByRole('tab', { name: 'Treino' }))
    expect(await screen.findByText('Pool muito concentrada')).toBeInTheDocument()
    expect(screen.getByText('80% das suas partidas foram de Ahri')).toBeInTheDocument()
    const section = screen.getByRole('region', { name: 'Campeões para experimentar' })
    expect(within(section).getByText('Joga parecido com Ahri: mesma classe (Mago).')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Adicionar Syndra à Pool' }))
    expect(await within(section).findByRole('button', { name: 'Adicionar Syndra à Pool' })).toHaveTextContent('Na Pool')
    expect(screen.getByRole('region', { name: 'Fundamentos de Meio' })).toBeInTheDocument()
  })

  it('destaca a vez de banir e de escolher com um aviso próprio, que some quando a vez passa', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    await screen.findByTestId('verdict')
    expect(screen.queryByRole('region', { name: /^Sua vez de/ })).not.toBeInTheDocument()

    act(() => fake.pushDraft({ ...draftWithZed(), turn: { id: 3, type: 'ban', championId: 0 } }))
    expect(await screen.findByRole('region', { name: 'Sua vez de banir' })).toBeInTheDocument()

    act(() => fake.pushDraft({ ...draftWithZed(), turn: { id: 7, type: 'pick', championId: 0 } }))
    const pick = await screen.findByRole('region', { name: 'Sua vez de escolher' })
    expect(pick).toHaveTextContent('Orianna')
    expect(screen.queryByRole('region', { name: 'Sua vez de banir' })).not.toBeInTheDocument()

    act(() => fake.pushDraft(draftWithZed()))
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Sua vez de/ })).not.toBeInTheDocument())
  })

  it('o Plano de jogo vem depois da build e do envio para o LoL', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft({ ...draftWithZed(), allies: [player(0, 0, 'none', 'TOP'), player(1, 103, 'locked', 'MIDDLE')] }))
    const build = await screen.findByRole('region', { name: 'Build' })
    const plan = await screen.findByRole('region', { name: 'Plano de jogo' })
    expect(build.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('o fim do draft volta para a tela de espera', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    await screen.findByTestId('verdict')

    act(() => fake.endDraft())
    expect(await screen.findByText('Conectado. Entre em uma fila.')).toBeInTheDocument()
    expect(screen.queryByTestId('verdict')).not.toBeInTheDocument()
  })

  it('mostra o estado do cliente em tempo real', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado ao cliente')
    act(() => fake.pushStatus('disconnected'))
    expect(await screen.findByText('Cliente fechado')).toBeInTheDocument()
  })

  it('editor de Pool: adiciona um campeão, ajusta o conforto e salva só o que mudou', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')

    await user.click(screen.getByRole('tab', { name: 'Pools' }))
    const dialog = await screen.findByRole('region', { name: 'Perfis e Pools' })
    const save = within(dialog).getByRole('button', { name: 'Salvar perfil' })
    expect(save).toBeDisabled() // nada mudou ainda

    await user.type(within(dialog).getByLabelText('Buscar campeão'), 'zed')
    await user.click(await within(dialog).findByRole('button', { name: 'Zed' }))
    expect(save).toBeEnabled()

    const poolList = within(dialog).getByLabelText('Pool de Meio')
    const zedRow = within(poolList).getByText('Zed').closest('li') as HTMLElement
    await user.click(within(zedRow).getByRole('button', { name: '5 de 5' }))

    await user.click(save)
    await waitFor(() => expect(fake.saveProfile).toHaveBeenCalledTimes(1))
    const sent = fake.saveProfile.mock.calls[0][0] as ProfileInput
    expect(sent.id).toBe('p1')
    expect(sent.pool?.MIDDLE.map((e) => [e.championId, e.comfort])).toContainEqual([238, 5])
    expect(sent.pool?.MIDDLE).toHaveLength(5)
    await waitFor(() => expect(save).toBeDisabled()) // salvo: volta ao estado limpo
  })

  it('editor de Pool: não deixa salvar sem apelido', async () => {
    const user = userEvent.setup()
    const fake = installApi({ profiles: [] })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Criar o primeiro perfil' }))
    const dialog = await screen.findByRole('region', { name: 'Perfis e Pools' })

    await user.type(within(dialog).getByLabelText(/Notas do perfil/), 'teste') // sujo, mas sem apelido
    await user.click(within(dialog).getByRole('button', { name: 'Salvar perfil' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Dê um apelido ao perfil antes de salvar.')
    expect(fake.saveProfile).not.toHaveBeenCalled()
  })
})

describe('tutorial de primeira vez', () => {
  it('abre só quando ainda não foi visto, passa os passos e não volta depois de pular', async () => {
    const user = userEvent.setup()
    const fake = installApi({ tourDone: false })
    const setSettings = vi.spyOn(fake.api, 'setSettings')
    render(<App />)
    const tour = await screen.findByRole('dialog', { name: 'Tutorial' })
    expect(within(tour).getByText('Bem-vindo ao Pedro.gg')).toBeInTheDocument()
    await user.click(within(tour).getByRole('button', { name: 'Próximo' }))
    expect(within(tour).getByText('1. Monte as Pools')).toBeInTheDocument()
    await user.click(within(tour).getByRole('button', { name: 'Voltar' }))
    expect(within(tour).getByText('Bem-vindo ao Pedro.gg')).toBeInTheDocument()
    await user.click(within(tour).getByRole('button', { name: 'Pular' }))
    expect(screen.queryByRole('dialog', { name: 'Tutorial' })).not.toBeInTheDocument()
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ tourDone: true }))
  })

  it('não abre para quem já viu e dá para rever nas Configurações', async () => {
    const user = userEvent.setup()
    installApi({ tourDone: true })
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    expect(screen.queryByRole('dialog', { name: 'Tutorial' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Configurações' }))
    await user.click(await screen.findByRole('button', { name: 'Rever tutorial' }))
    expect(await screen.findByRole('dialog', { name: 'Tutorial' })).toBeInTheDocument()
  })

  it('no último passo, sem perfil, oferece criar o perfil e abre a tela de Pools', async () => {
    const user = userEvent.setup()
    installApi({ tourDone: false, profiles: [] })
    render(<App />)
    const tour = await screen.findByRole('dialog', { name: 'Tutorial' })
    for (let i = 0; i < 6; i++) await user.click(within(tour).getByRole('button', { name: 'Próximo' }))
    await user.click(within(tour).getByRole('button', { name: 'Criar meu perfil' }))
    expect(await screen.findByRole('region', { name: 'Perfis e Pools' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Pools' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Pools como tela do menu', () => {
  it('avisa antes de sair da tela com alterações não salvas', async () => {
    const user = userEvent.setup()
    installApi()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    await user.click(screen.getByRole('tab', { name: 'Pools' }))
    const screenPools = await screen.findByRole('region', { name: 'Perfis e Pools' })
    await user.type(within(screenPools).getByLabelText('Buscar campeão'), 'zed')
    await user.click(await within(screenPools).findByRole('button', { name: 'Zed' }))

    await user.click(screen.getByRole('tab', { name: 'Meta' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('tab', { name: 'Pools' })).toHaveAttribute('aria-selected', 'true') // recusou: continua nela

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('tab', { name: 'Meta' }))
    expect(await screen.findByRole('list', { name: 'Ranking de Meio' })).toBeInTheDocument()
    confirm.mockRestore()
  })

  it('sem alterações, sai sem perguntar', async () => {
    const user = userEvent.setup()
    installApi()
    const confirm = vi.spyOn(window, 'confirm')
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    await user.click(screen.getByRole('tab', { name: 'Pools' }))
    await screen.findByRole('region', { name: 'Perfis e Pools' })
    await user.click(screen.getByRole('tab', { name: 'Draft' }))
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})

describe('Pools: filtros, importação e compartilhamento', () => {
  async function openPool() {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    await user.click(screen.getByRole('tab', { name: 'Pools' }))
    const dialog = await screen.findByRole('region', { name: 'Perfis e Pools' })
    return { user, fake, dialog }
  }
  const grid = (dialog: HTMLElement) => within(within(dialog).getByRole('list', { name: 'Campeões' })).queryAllByRole('button').map((b) => b.getAttribute('aria-label'))

  it('por padrão mostra só os campeões da rota; "Todos" libera os outros', async () => {
    const { user, dialog } = await openPool()
    // Meio: Ahri, Syndra, Orianna, Yasuo, Zed. Garen (topo), Leona (suporte) ficam de fora.
    expect(grid(dialog)).toEqual(expect.arrayContaining(['Ahri', 'Syndra', 'Orianna', 'Yasuo', 'Zed']))
    expect(grid(dialog)).not.toContain('Garen')
    expect(grid(dialog)).not.toContain('Leona')

    await user.click(within(dialog).getByRole('button', { name: 'Todos' }))
    expect(grid(dialog)).toEqual(expect.arrayContaining(['Garen', 'Leona', 'Ahri']))

    // trocar de aba muda a lista do modo "Só de ..."
    await user.click(within(dialog).getByRole('button', { name: 'Só de Meio' }))
    await user.click(within(dialog).getByRole('tab', { name: /Topo/ }))
    expect(grid(dialog)).toContain('Garen')
    expect(grid(dialog)).not.toContain('Ahri')
  })

  it('filtra por classe e por função, e "Limpar filtros" desfaz', async () => {
    const { user, dialog } = await openPool()
    await user.click(within(dialog).getByRole('button', { name: 'Todos' }))
    await user.click(within(dialog).getByRole('button', { name: /^Filtros/ }))

    await user.click(within(within(dialog).getByRole('group', { name: 'Filtrar por classe' })).getByRole('button', { name: 'Tanque' }))
    expect(grid(dialog).sort()).toEqual(['Garen', 'Leona'])

    await user.click(within(within(dialog).getByRole('group', { name: 'Filtrar por função' })).getByRole('button', { name: 'Vanguarda' }))
    expect(grid(dialog)).toEqual(['Leona'])

    await user.click(within(dialog).getByRole('button', { name: 'Limpar filtros' }))
    expect(grid(dialog)).toHaveLength(7)

    // filtro por rota (só aparece em "Todos")
    await user.click(within(within(dialog).getByRole('group', { name: 'Filtrar por rota' })).getByRole('button', { name: 'Suporte' }))
    expect(grid(dialog)).toEqual(['Leona']) // Suporte, sem filtro de classe/função
    expect(grid(dialog)).not.toContain('Ahri')
  })

  it('importar um código mostra a prévia e carrega como perfil novo, sem salvar sozinho', async () => {
    const { user, fake, dialog } = await openPool()
    fake.decodeShare.mockResolvedValue({
      ok: true,
      shared: {
        nickname: 'Amigo',
        mainRoles: ['TOP'],
        pool: { TOP: [{ championId: 86, championKey: 'Garen', comfort: 4 }], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] }
      }
    })

    await user.click(within(dialog).getByRole('button', { name: 'Importar de um amigo' }))
    const imp = await screen.findByRole('dialog', { name: 'Importar Pool' })
    await user.click(within(imp).getByRole('button', { name: 'Colar da área de transferência' }))
    expect(await within(imp).findByText('Pool de Amigo')).toBeInTheDocument()
    expect(within(imp).getByText(/1 campeão no total/)).toBeInTheDocument()

    await user.click(within(imp).getByRole('button', { name: 'Importar' }))
    expect(screen.queryByRole('dialog', { name: 'Importar Pool' })).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Apelido')).toHaveValue('Amigo')
    expect(fake.saveProfile).not.toHaveBeenCalled() // só salva quando a pessoa clica em Salvar
    expect(within(dialog).getByRole('button', { name: 'Salvar perfil' })).toBeEnabled()
  })

  it('importar "juntando" mantém o que já existe e acrescenta o que falta', async () => {
    const { user, fake, dialog } = await openPool()
    fake.decodeShare.mockResolvedValue({
      ok: true,
      shared: {
        nickname: 'Amigo',
        mainRoles: [],
        pool: { TOP: [], JUNGLE: [], BOTTOM: [], UTILITY: [], MIDDLE: [{ championId: 103, championKey: 'Ahri', comfort: 1 }, { championId: 238, championKey: 'Zed', comfort: 5 }] }
      }
    })
    await user.click(within(dialog).getByRole('button', { name: 'Importar de um amigo' }))
    const imp = await screen.findByRole('dialog', { name: 'Importar Pool' })
    await user.click(within(imp).getByRole('button', { name: 'Colar da área de transferência' }))
    await user.click(await within(imp).findByLabelText(/Juntar com o perfil Pedro.*1 campeão novo/))
    await user.click(within(imp).getByRole('button', { name: 'Importar' }))

    await user.click(within(dialog).getByRole('button', { name: 'Salvar perfil' }))
    await waitFor(() => expect(fake.saveProfile).toHaveBeenCalled())
    const sent = fake.saveProfile.mock.calls[0][0] as ProfileInput
    expect(sent.id).toBe('p1')
    expect(sent.nickname).toBe('Pedro')
    const mid = Object.fromEntries(sent.pool!.MIDDLE.map((e) => [e.championId, e.comfort]))
    expect(mid[103]).toBe(4) // o conforto do Ahri continua o seu
    expect(mid[238]).toBe(5) // Zed veio do amigo
    expect(Object.keys(mid)).toHaveLength(5)
  })

  it('mostra o motivo quando o código não vale', async () => {
    const { user, dialog } = await openPool()
    await user.click(within(dialog).getByRole('button', { name: 'Importar de um amigo' }))
    const imp = await screen.findByRole('dialog', { name: 'Importar Pool' })
    await user.type(within(imp).getByLabelText(/Cole o código/), 'lixo')
    expect(await within(imp).findByRole('alert')).toHaveTextContent('Não reconheci isso como uma Pool do Pedro.gg.')
    expect(within(imp).queryByRole('button', { name: 'Importar' })).not.toBeInTheDocument()
  })

  it('compartilhar gera o código e copia', async () => {
    const { user, fake, dialog } = await openPool()
    await user.click(within(dialog).getByRole('button', { name: 'Compartilhar esta Pool' }))
    const share = await screen.findByRole('dialog', { name: 'Compartilhar Pool' })
    await waitFor(() => expect(within(share).getByLabelText('Código da Pool')).toHaveValue('PGG1:codigo-de-teste'))
    await user.click(within(share).getByRole('button', { name: 'Copiar código' }))
    expect(fake.copyText).toHaveBeenCalledWith('PGG1:codigo-de-teste')
    expect(await within(share).findByText(/Código copiado/)).toBeInTheDocument()
  })
})

describe('sugestão: risco, prioridade e composição', () => {
  it('troca a prioridade e mostra a composição dos times', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    await screen.findByTestId('verdict')

    const group = screen.getByRole('group', { name: 'Prioridade da sugestão' })
    expect(within(group).getByRole('button', { name: 'Equilibrado' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(group).getByRole('button', { name: 'Conforto' }))
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Conforto' })).toHaveAttribute('aria-pressed', 'true'))
    // com muito peso em conforto, Syndra (5 estrelas) passa a Orianna (3)
    await waitFor(() => expect(screen.getByTestId('verdict')).toHaveTextContent('Syndra'))

    expect(screen.getByRole('region', { name: 'Composição do time inimigo' })).toHaveTextContent('Físico')
  })
})

describe('atualização do app', () => {
  it('avisa de versão nova, só baixa quando aceita e deixa reiniciar depois do download', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    expect(screen.queryByRole('status', { name: 'Atualização do app' })).not.toBeInTheDocument()

    fake.pushUpdate({ status: 'available', current: '0.1.0', latest: '0.2.0', notes: 'Filtros novos' })
    const banner = await screen.findByRole('status', { name: 'Atualização do app' })
    expect(banner).toHaveTextContent('0.2.0')
    await user.click(within(banner).getByRole('button', { name: 'Ver novidades' }))
    expect(within(banner).getByText('Filtros novos')).toBeInTheDocument()

    await user.click(within(banner).getByRole('button', { name: 'Atualizar agora' }))
    const ready = await within(await screen.findByRole('status', { name: 'Atualização do app' })).findByRole('button', { name: 'Reiniciar e atualizar' })
    await user.click(ready)
    expect(fake.installUpdate).toHaveBeenCalledTimes(1)
  })

  it('"Depois" esconde o aviso daquela versão', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    fake.pushUpdate({ status: 'available', current: '0.1.0', latest: '0.2.0' })
    await user.click(await screen.findByRole('button', { name: 'Depois' }))
    expect(screen.queryByRole('status', { name: 'Atualização do app' })).not.toBeInTheDocument()
    fake.pushUpdate({ status: 'available', current: '0.1.0', latest: '0.3.0' }) // versão mais nova: avisa de novo
    expect(await screen.findByRole('status', { name: 'Atualização do app' })).toHaveTextContent('0.3.0')
  })

  it('durante o draft não deixa reiniciar', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    await screen.findByTestId('verdict')
    fake.pushUpdate({ status: 'ready', current: '0.1.0', latest: '0.2.0' })
    expect(await screen.findByRole('button', { name: 'Reiniciar e atualizar' })).toBeDisabled()
  })
})

describe('sem internet', () => {
  it('quando o ícone não carrega, mostra a inicial do campeão em vez do texto alternativo', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    const verdict = await screen.findByTestId('verdict')

    const img = await within(verdict).findByRole('img', { name: 'Orianna' })
    expect(img.tagName).toBe('IMG')
    fireEvent.error(img) // o CDN não respondeu

    const tile = await within(verdict).findByRole('img', { name: 'Orianna' })
    expect(tile.tagName).toBe('DIV')
    expect(tile).toHaveTextContent('O')
  })
})

describe('pós-jogo e aviso de patch', () => {
  it('a aba Pós-jogo sem partidas explica e oferece buscar a última', async () => {
    installApi()
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Pós-jogo/ }))
    expect(await screen.findByText('Sua primeira análise aparece aqui')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Analisar a última partida/ })).toBeEnabled()
  })

  it('mostra a análise da partida: nota, dicas, diferenças e placar', async () => {
    installApi({ postGames: [postGameFixture()] })
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: /Pós-jogo/ }))
    expect(await screen.findByText('Vitória', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Nota \d+ de 100/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'O que a partida mostrou' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /CS por minuto/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Diferença de ouro entre o seu time/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Radar:/ })).toBeInTheDocument()
    expect(screen.getByText('Dragões')).toBeInTheDocument()
    expect(screen.getAllByText('Você', { selector: 'span.truncate' })).toHaveLength(1) // linha do placar
    expect(screen.getByRole('button', { name: 'Remover do histórico' })).toBeInTheDocument()
  })

  it('avisa quando os dados de builds são de um patch mais velho que o do jogo', async () => {
    installApi({ metaPatch: '16.18' })
    render(<App />)
    expect(await screen.findByText(/são do patch 16\.18 e o jogo está no 16\.20/)).toBeInTheDocument()
  })

  it('não avisa quando o patch é o mesmo', async () => {
    installApi({ metaPatch: '16.20' })
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    expect(screen.queryByText(/e o jogo está no/)).not.toBeInTheDocument()
  })
})

describe('0.6: counters do meta, evolução e aviso de patch', () => {
  it('sugere counters fora da Pool e adiciona o campeão à Pool com um clique', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    ;(fake.api as { getMetaCounters: LolApi['getMetaCounters'] }).getMetaCounters = async () => [
      { championId: 238, enemyId: 157, role: 'MIDDLE', winrate: 0.61, games: 120, score: 0.58 }
    ]
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))

    const card = await screen.findByRole('region', { name: 'Counters do meta' })
    expect(within(card).getByText(/Vence 61(,0)?% contra Yasuo \(120 jogos\)/)).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Adicionar Zed à Pool' }))
    expect(fake.saveProfile).toHaveBeenCalledTimes(1)
    const sent = fake.saveProfile.mock.calls[0][0] as ProfileInput
    expect(sent.pool?.MIDDLE.some((e) => e.championId === 238 && e.comfort === 1)).toBe(true)
    expect(sent.pool?.MIDDLE).toHaveLength(5)
    expect(await within(card).findByRole('button', { name: 'Adicionar Zed à Pool' })).toBeDisabled()
  })

  it('sem counters, o cartão não aparece', async () => {
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    act(() => fake.pushDraft(draftWithZed()))
    await screen.findByRole('region', { name: 'Sugestões de banimento' }).catch(() => undefined)
    expect(screen.queryByRole('region', { name: 'Counters do meta' })).not.toBeInTheDocument()
  })

  it('o Pós-jogo tem a aba Evolução com resumo e gráfico', async () => {
    const user = userEvent.setup()
    const base = postGameFixture()
    const more = Array.from({ length: 4 }, (_, i) => ({
      ...base,
      summary: { ...base.summary, gameId: base.summary.gameId + i + 1, score: 50 + i * 5, win: i % 2 === 0 }
    }))
    installApi({ postGames: [base, ...more] })
    render(<App />)
    await user.click(await screen.findByRole('tab', { name: /Pós-jogo/ }))
    await user.click(await screen.findByRole('tab', { name: 'Evolução' }))
    const panel = await screen.findByRole('tabpanel', { name: 'Evolução' })
    expect(within(panel).getByText('Partidas analisadas')).toBeInTheDocument()
    expect(within(panel).getByRole('img', { name: /Nota de cada partida/ })).toBeInTheDocument()
    expect(within(panel).getByRole('region', { name: 'Desempenho por campeão' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Partida' }))
    expect(await screen.findByRole('complementary', { name: 'Partidas analisadas' })).toBeInTheDocument()
  })

  it('troca o atalho do overlay apertando as teclas, recusa o repetido e volta ao padrão', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    const setSettings = vi.spyOn(fake.api, 'setSettings')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Configurações' }))
    const dialog = await screen.findByRole('dialog', { name: 'Configurações' })
    await user.click(within(dialog).getByRole('tab', { name: /^Partida/ }))
    const size = await screen.findByRole('button', { name: 'Atalho de tamanho do overlay' })
    expect(size).toHaveTextContent('Ctrl+Shift+F9')
    expect(screen.getByRole('button', { name: 'Atalho de mover o overlay' })).toHaveTextContent('Ctrl+Shift+F10')

    await user.click(size)
    await user.keyboard('{Control>}{Shift>}{F10}{/Shift}{/Control}') // igual ao do mover
    expect(await screen.findByText('Já é o outro atalho.')).toBeInTheDocument()
    expect(setSettings).not.toHaveBeenCalledWith(expect.objectContaining({ overlayKeySize: expect.anything() }))

    await user.keyboard('{Control>}{Alt>}{F8}{/Alt}{/Control}')
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ overlayKeySize: 'CommandOrControl+Alt+F8' }))
    await user.click(await screen.findByRole('button', { name: 'Padrão' }))
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ overlayKeySize: 'CommandOrControl+Shift+F9' }))
  })

  it('avisa o que mudou no patch para a Pool e some ao confirmar', async () => {
    const user = userEvent.setup()
    const fake = installApi()
    const ack = vi.fn(async () => undefined)
    ;(fake.api as { getPatchChanges: LolApi['getPatchChanges'] }).getPatchChanges = async () => ({
      fromPatch: '16.19',
      toPatch: '16.20',
      changes: [{ championId: 103, role: 'MIDDLE', fromTier: 'B', toTier: 'A', winrateFrom: 0.5, winrateTo: 0.53 }]
    })
    ;(fake.api as { ackPatchChanges: LolApi['ackPatchChanges'] }).ackPatchChanges = ack
    render(<App />)
    const note = await screen.findByRole('status', { name: 'Mudanças do patch' })
    expect(within(note).getByText(/Patch 16\.20: mudou 1 campeão das suas Pools desde o 16\.19/)).toBeInTheDocument()
    expect(within(note).getByText('Ahri')).toBeInTheDocument()
    await user.click(within(note).getByRole('button', { name: 'Entendi' }))
    expect(ack).toHaveBeenCalled()
    expect(screen.queryByRole('status', { name: 'Mudanças do patch' })).not.toBeInTheDocument()
  })
})
