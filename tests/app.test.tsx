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

function installApi(opts: { profiles?: FriendProfile[]; postGames?: { summary: PgSummary; detail: PgDetail }[]; metaPatch?: string } = {}): Fake {
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
    pickMode: 'balanced',
    autoAccept: false,
    autoAcceptDelay: 1,
    introAnimation: true,
    reduceMotion: false
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

  const api: LolApi = {
    onMetaUpdated: () => () => {},
    onAutoAccepted: () => () => {},
    getDiagnostics: async () => 'diagnóstico de teste',
    getLastAccept: async () => null,
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
    poolOpen: false,
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
    await user.click(within(group).getByRole('button', { name: 'Mid' }))

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
    await user.click(within(panel).getByRole('checkbox', { name: /Itens/ })) // desmarca os itens
    await user.click(within(panel).getByRole('button', { name: 'Importar para o cliente' }))

    await waitFor(() => expect(apply).toHaveBeenCalledWith({ championId: 103, role: 'MIDDLE', parts: { runes: true, spells: true, items: false } }))
    expect(await within(panel).findByText(/Runas: Runas aplicadas/)).toBeInTheDocument()
  })

  it('mostra o painel "Para esta partida" com o foco da build e o motivo da composição', async () => {
    const fake = installApi()
    fake.setSituation({
      enemiesKnown: 3,
      enemyDamage: { physical: 0.8, magic: 0.2 },
      tankyEnemies: 0,
      focus: 'armor',
      picks: [{ itemId: 3089, reason: 'armor' }],
      variantIndex: null
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

    await user.click(screen.getByRole('button', { name: 'Pools' }))
    const dialog = await screen.findByRole('dialog', { name: 'Perfis e Pools' })
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
    const dialog = await screen.findByRole('dialog', { name: 'Perfis e Pools' })

    await user.type(within(dialog).getByLabelText(/Notas do perfil/), 'teste') // sujo, mas sem apelido
    await user.click(within(dialog).getByRole('button', { name: 'Salvar perfil' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Dê um apelido ao perfil antes de salvar.')
    expect(fake.saveProfile).not.toHaveBeenCalled()
  })
})

describe('Pools: filtros, importação e compartilhamento', () => {
  async function openPool() {
    const user = userEvent.setup()
    const fake = installApi()
    render(<App />)
    await screen.findByText('Conectado. Entre em uma fila.')
    await user.click(screen.getByRole('button', { name: 'Pools' }))
    const dialog = await screen.findByRole('dialog', { name: 'Perfis e Pools' })
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
