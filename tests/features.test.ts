import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { CHAMPION_TRAITS, CLASSES, STYLES, countByRole, defaultFilter, filterChampions, playsRole } from '../src/shared/championMeta'
import { analyzeComp } from '../src/shared/comp'
import { emptyPool, mergePools, countNew } from '../src/shared/poolShare'
import { decodeShare, encodeShare, toFileJson } from '../src/main/store/share'
import { recommend } from '../src/main/data/recommender'
import { validateDataset } from '../src/main/data/meta'
import { UpdateService, notesToText, type UpdaterLike } from '../src/main/updater'
import type { ChampionInfo, FriendProfile, MetaDataset, Pool } from '../src/shared/dataTypes'
import type { DraftPlayer, DraftState } from '../src/shared/types'

// ------------------------------------------------------------------------ rotas e filtros

const champ = (id: number, key: string, tags: string[] = [], info?: ChampionInfo['info']): ChampionInfo => ({
  id,
  key,
  name: key,
  iconUrl: '',
  tags,
  ...(info ? { info } : {})
})

describe('tabela de rotas e funções', () => {
  it('só usa rotas e estilos válidos e cada rota tem campeões suficientes', () => {
    for (const [key, t] of Object.entries(CHAMPION_TRAITS)) {
      expect(key).toMatch(/^[A-Za-z0-9]+$/)
      expect(t.positions.length, key).toBeGreaterThan(0)
      expect(new Set(t.positions).size, key).toBe(t.positions.length) // sem rota repetida
      expect(STYLES, key).toContain(t.style)
    }
    const n = countByRole()
    for (const r of Object.keys(n) as (keyof typeof n)[]) expect(n[r], r).toBeGreaterThan(20)
    expect(Object.keys(CHAMPION_TRAITS).length).toBeGreaterThan(160)
  })

  it('campeão sem dados (lançamento novo) nunca some do filtro de rota', () => {
    expect(playsRole('CampeaoNovoQueNaoExiste', 'TOP')).toBe(true)
    expect(playsRole('Ahri', 'MIDDLE')).toBe(true)
    expect(playsRole('Ahri', 'TOP')).toBe(false)
  })

  const catalog = [
    { ...champ(103, 'Ahri', ['Mage', 'Assassin']) },
    { ...champ(86, 'Garen', ['Fighter', 'Tank']) },
    { ...champ(89, 'Leona', ['Tank', 'Support']) },
    { ...champ(222, 'Jinx', ['Marksman']) },
    { ...champ(999, 'Novato', ['Mage']) }
  ]
  const q = (c: { name: string }, text: string): boolean => c.name.toLowerCase().includes(text)

  it('"só da rota" mostra os da rota; "todos" libera os demais; lanes/classe/função combinam', () => {
    const names = (f: ReturnType<typeof defaultFilter>): string[] => filterChampions(catalog, f, q).map((c) => c.name)

    expect(names(defaultFilter('MIDDLE'))).toEqual(['Ahri', 'Novato']) // Novato: sem dados, não some
    expect(names({ ...defaultFilter('MIDDLE'), scope: 'all' })).toHaveLength(5)
    expect(names({ ...defaultFilter('MIDDLE'), scope: 'all', lanes: ['BOTTOM'] })).toEqual(['Jinx', 'Novato'])
    expect(names({ ...defaultFilter('TOP'), scope: 'all', classes: ['Tank'] })).toEqual(['Garen', 'Leona'])
    expect(names({ ...defaultFilter('TOP'), scope: 'all', styles: ['MARKSMAN'] })).toEqual(['Jinx'])
    expect(names({ ...defaultFilter('TOP'), scope: 'all', classes: ['Tank'], styles: ['VANGUARD'] })).toEqual(['Leona'])
    expect(names({ ...defaultFilter('TOP'), scope: 'all', query: 'gar' })).toEqual(['Garen'])
    expect(CLASSES).toContain('Marksman')
  })
})

// ------------------------------------------------------------------------ composição

describe('composição do time', () => {
  it('avisa quando falta frontline e quando o dano é de um tipo só (só com 3+ picks)', () => {
    const ad = { attack: 9, defense: 3, magic: 1, difficulty: 5 }
    expect(analyzeComp([])).toBeNull()
    expect(analyzeComp([champ(1, 'A', ['Marksman'], ad), champ(2, 'B', ['Fighter'], ad)])!.warnings).toEqual([])
    const comp = analyzeComp([1, 2, 3].map((i) => champ(i, `C${i}`, ['Marksman'], ad)))!
    expect(comp.warnings).toEqual(['no-frontline', 'mostly-ad'])
    expect(comp.ad).toBeGreaterThan(0.85)
    const tank = analyzeComp([champ(1, 'T', ['Tank'], { attack: 4, defense: 9, magic: 3, difficulty: 3 }), ...[2, 3].map((i) => champ(i, `M${i}`, ['Mage'], { attack: 2, defense: 3, magic: 9, difficulty: 5 }))])!
    expect(tank.frontline).toBe(1)
    expect(tank.warnings).toEqual([]) // misto o bastante e com frontline
  })

  it('sem notas do Data Dragon, estima pela classe', () => {
    const comp = analyzeComp([1, 2, 3].map((i) => champ(i, `M${i}`, ['Mage'])))!
    expect(comp.ap).toBeGreaterThan(0.75)
    expect(comp.warnings).toContain('mostly-ap')
  })
})

// ------------------------------------------------------------------------ compartilhar Pool

const pool = (): Pool => ({
  ...emptyPool(),
  MIDDLE: [
    { championId: 103, championKey: 'Ahri', comfort: 5, notes: 'flash + ignite' },
    { championId: 134, championKey: 'Syndra', comfort: 3 }
  ],
  TOP: [{ championId: 86, championKey: 'Garen', comfort: 4 }]
})

const profile = { id: 'p1', nickname: 'Pedro', riotId: 'Pedro#BR1', notes: 'privado', mainRoles: ['MIDDLE'], pool: pool() }

describe('compartilhar Pool', () => {
  it('o código vai e volta sem perder nada, e é curto', () => {
    const code = encodeShare(profile, { includeNotes: true })
    expect(code.startsWith('PGG1:')).toBe(true)
    expect(code.length).toBeLessThan(400)
    const r = decodeShare(code)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.shared.nickname).toBe('Pedro')
    expect(r.shared.riotId).toBe('Pedro#BR1')
    expect(r.shared.mainRoles).toEqual(['MIDDLE'])
    expect(r.shared.notes).toBe('privado')
    expect(r.shared.pool.MIDDLE).toEqual(pool().MIDDLE)
    expect(r.shared.pool.TOP).toEqual(pool().TOP)
    expect(JSON.stringify(r.shared)).not.toContain('"id"') // id interno não viaja
  })

  it('sem marcar "incluir anotações", nenhuma anotação sai do app', () => {
    const code = encodeShare(profile, { includeNotes: false })
    const r = decodeShare(code)
    expect(r.ok && r.shared.notes).toBeFalsy()
    expect(r.ok && r.shared.pool.MIDDLE[0].notes).toBeUndefined()
    expect(toFileJson(profile, { includeNotes: false })).not.toContain('flash + ignite')
    expect(toFileJson(profile, { includeNotes: false })).not.toContain('privado')
  })

  it('acha o código no meio de uma mensagem e aceita o arquivo exportado', () => {
    const code = encodeShare(profile, { includeNotes: true })
    const msg = decodeShare(`Fala! Minha pool:\n${code}\nvaleu`)
    expect(msg.ok && msg.shared.pool.MIDDLE).toHaveLength(2)
    const file = decodeShare(toFileJson(profile, { includeNotes: true }))
    expect(file.ok && file.shared.pool.TOP).toHaveLength(1)
  })

  it('rejeita lixo, código cortado e conteúdo malicioso sem quebrar', () => {
    expect(decodeShare('').ok).toBe(false)
    expect(decodeShare('oi tudo bem').ok).toBe(false)
    expect(decodeShare(42).ok).toBe(false)
    const code = encodeShare(profile, { includeNotes: true })
    expect(decodeShare(code.slice(0, code.length - 12)).ok).toBe(false)
    expect(decodeShare('{"type":"pool","pool":"x"}').ok).toBe(false)
    expect(decodeShare('x'.repeat(500_000)).ok).toBe(false)

    // campos inválidos são descartados, não repassados
    const evil = decodeShare(
      JSON.stringify({
        type: 'pool',
        nickname: '<b>' + 'n'.repeat(100),
        mainRoles: ['TOP', 'HACK'],
        pool: { MIDDLE: [{ championId: -1, championKey: 'Ahri', comfort: 3 }, { championId: 5, championKey: '../x', comfort: 3 }, { championId: 103, championKey: 'Ahri', comfort: 99 }] }
      })
    )
    expect(evil.ok).toBe(true)
    if (evil.ok) {
      expect(evil.shared.nickname.length).toBeLessThanOrEqual(40)
      expect(evil.shared.mainRoles).toEqual(['TOP'])
      expect(evil.shared.pool.MIDDLE).toEqual([{ championId: 103, championKey: 'Ahri', comfort: 5 }])
    }
  })

  it('juntar mantém o que você tem e só acrescenta o que falta; substituir troca tudo', () => {
    const mine: Pool = { ...emptyPool(), MIDDLE: [{ championId: 103, championKey: 'Ahri', comfort: 2 }] }
    const theirs = pool()
    expect(countNew(mine, theirs)).toBe(2) // Syndra e Garen
    const merged = mergePools(mine, theirs, 'merge')
    expect(merged.MIDDLE.map((e) => [e.championId, e.comfort])).toEqual([[103, 2], [134, 3]]) // conforto do Ahri continua o seu
    expect(merged.TOP).toHaveLength(1)
    expect(mine.MIDDLE).toHaveLength(1) // não altera o original
    expect(mergePools(mine, theirs, 'replace').MIDDLE).toHaveLength(2)
  })
})

// ------------------------------------------------------------------------ recomendação

const P = (cellId: number, championId: number, status: DraftPlayer['status'], role: DraftPlayer['role'] = null): DraftPlayer => ({ cellId, championId, status, role })
const draft = (over: Partial<DraftState> = {}): DraftState => ({
  phase: 'BAN_PICK',
  localPlayerCellId: 1,
  localRole: 'MIDDLE',
  allies: [P(0, 0, 'none', 'TOP'), P(1, 0, 'none', 'MIDDLE')],
  enemies: [P(5, 0, 'none')],
  bans: { allies: [], enemies: [] },
  ...over
})
const me = (champs: [number, string, number][]): FriendProfile => ({
  id: 'p',
  nickname: 'x',
  mainRoles: [],
  createdAt: '',
  updatedAt: '',
  pool: { ...emptyPool(), MIDDLE: champs.map(([championId, championKey, comfort]) => ({ championId, championKey, comfort })) }
})

// A (1) e B (2) no meio. C (3) é um counter forte de A; D (4) ajuda A quando está no time.
const dataset: MetaDataset = validateDataset({
  schemaVersion: 1,
  source: 't',
  patch: '1',
  generatedAt: '',
  champions: {
    '1': { roles: { MIDDLE: { games: 10000, wins: 5000, matchups: { '3': { games: 3000, wins: 1200 } }, synergies: { '4': { games: 4000, wins: 2400 } } } } },
    '2': { roles: { MIDDLE: { games: 10000, wins: 5000, matchups: {}, synergies: { '4': { games: 4000, wins: 2000 } } } } },
    '3': { roles: { MIDDLE: { games: 10000, wins: 5000, matchups: {} } } },
    '4': { roles: { TOP: { games: 10000, wins: 5000, matchups: {} } } }
  }
})

describe('recomendação: sinergia e risco', () => {
  it('sinergia com aliado já escolhido sobe o score só de quem tem dados', () => {
    const none = recommend({ draft: draft(), profile: me([[1, 'A', 3], [2, 'B', 3]]), dataset })
    const withAlly = recommend({
      draft: draft({ allies: [P(0, 4, 'locked', 'TOP'), P(1, 0, 'none', 'MIDDLE')] }),
      profile: me([[1, 'A', 3], [2, 'B', 3]]),
      dataset
    })
    const a = (r: typeof none) => r.ranking.find((x) => x.championId === 1)!
    const b = (r: typeof none) => r.ranking.find((x) => x.championId === 2)!
    expect(a(none).factors.synergy).toBe(0)
    expect(a(withAlly).synergyDelta).toBeGreaterThan(5) // 60% com o Top vs 50% base
    expect(a(withAlly).factors.synergy).toBeGreaterThan(3)
    expect(a(withAlly).synergies[0].withChampionId).toBe(4)
    expect(b(withAlly).synergyDelta).toBeLessThan(1) // 50% com o Top = sem ganho
    expect(withAlly.ranking[0].championId).toBe(1)
  })

  it('aponta counters que o inimigo ainda pode pegar; some se estiverem banidos ou o oponente já for conhecido', () => {
    const open = recommend({ draft: draft(), profile: me([[1, 'A', 3]]), dataset })
    expect(open.ranking[0].risk.level).not.toBe('none')
    expect(open.ranking[0].risk.counters.map((c) => c.vsChampionId)).toEqual([3])
    expect(open.ranking[0].risk.counters[0].winrate).toBeLessThan(0.47)

    const banned = recommend({ draft: draft({ bans: { allies: [], enemies: [3] } }), profile: me([[1, 'A', 3]]), dataset })
    expect(banned.ranking[0].risk.level).toBe('none')

    const known = recommend({ draft: draft({ enemies: [P(5, 3, 'locked', 'MIDDLE')] }), profile: me([[1, 'A', 3]]), dataset })
    expect(known.ranking[0].risk.level).toBe('none') // o counter já foi escolhido: vira matchup real
    expect(known.ranking[0].matchupWinrate).toBeLessThan(0.45)

    const full = recommend({ draft: draft({ enemies: [5, 6, 7, 8, 9].map((c) => P(c, 90 + c, 'locked')) }), profile: me([[1, 'A', 3]]), dataset })
    expect(full.ranking[0].risk.level).toBe('none') // inimigo fechou o time
  })

  it('os modos mudam a ordem: conforto vs meta', () => {
    // B tem muito conforto, A tem winrate melhor
    const ds = validateDataset({
      schemaVersion: 1, source: 't', patch: '1', generatedAt: '',
      champions: {
        '1': { roles: { MIDDLE: { games: 100000, wins: 54000, matchups: {} } } },
        '2': { roles: { MIDDLE: { games: 100000, wins: 49000, matchups: {} } } }
      }
    })
    const prof = me([[1, 'A', 2], [2, 'B', 5]])
    expect(recommend({ draft: draft(), profile: prof, dataset: ds, mode: 'comfort' }).ranking[0].championId).toBe(2)
    expect(recommend({ draft: draft(), profile: prof, dataset: ds, mode: 'meta' }).ranking[0].championId).toBe(1)
  })
})

// ------------------------------------------------------------------------ atualização do app

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = false
  allowPrerelease = true
  feed: unknown = null
  checks = 0
  nextCheck: () => Promise<unknown> = async () => {
    this.emit('checking-for-update')
    this.emit('update-available', { version: '0.2.0', releaseNotes: '<h2>Novo</h2><ul><li>Filtros</li><li>Compartilhar Pool</li></ul>' })
  }
  setFeedURL(o: { provider: 'github'; owner: string; repo: string }): void {
    this.feed = o
  }
  async checkForUpdates(): Promise<unknown> {
    this.checks++
    return this.nextCheck()
  }
  async downloadUpdate(): Promise<unknown> {
    this.emit('download-progress', { percent: 41.6 })
    this.emit('update-downloaded', {})
    return null
  }
  quitAndInstall = vi.fn()
}

const service = (over: Partial<ConstructorParameters<typeof UpdateService>[0]> = {}) => {
  const updater = new FakeUpdater()
  const states: string[] = []
  const svc = new UpdateService({ updater, currentVersion: '0.1.0', repo: 'pedro/pedro-gg', packaged: true, onState: (s) => states.push(s.status), ...over })
  return { updater, svc, states }
}

describe('atualização do app', () => {
  it('só avisa; baixa depois do pedido; instala só quando está pronto', async () => {
    const { updater, svc, states } = service()
    expect(updater.feed).toEqual({ provider: 'github', owner: 'pedro', repo: 'pedro-gg' })
    expect(updater.autoDownload).toBe(false) // nunca baixa sozinho
    expect(updater.allowPrerelease).toBe(false)

    expect(svc.install()).toBe(false) // nada pronto ainda
    await svc.download() // nada disponível: ignora
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    const s = await svc.check(true)
    expect(s).toMatchObject({ status: 'available', current: '0.1.0', latest: '0.2.0' })
    expect(s.notes).toBe('Novo\nFiltros\nCompartilhar Pool')

    const done = await svc.download()
    expect(done.status).toBe('ready')
    expect(states).toContain('downloading')
    expect(svc.install()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('verificação automática falha em silêncio; a manual mostra o erro', async () => {
    const { updater, svc } = service()
    updater.nextCheck = async () => {
      updater.emit('checking-for-update')
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    }
    expect((await svc.check(false)).status).toBe('idle')
    const manual = await svc.check(true)
    expect(manual.status).toBe('error')
    expect(manual.message).toContain('ERR_INTERNET_DISCONNECTED')
  })

  it('sem versão nova volta a "idle" com a hora da verificação', async () => {
    const { updater, svc } = service()
    updater.nextCheck = async () => {
      updater.emit('checking-for-update')
      updater.emit('update-not-available', {})
    }
    const s = await svc.check(true)
    expect(s.status).toBe('idle')
    expect(s.checkedAt).toBeTruthy()
  })

  it('em desenvolvimento ou sem repositório, fica desligada e nunca consulta a rede', async () => {
    for (const over of [{ packaged: false }, { repo: '' }, { repo: 'sem-barra' }, { repo: '../x/y z' }, { updater: null }]) {
      const { updater, svc } = service(over)
      expect(svc.getState().status).toBe('unsupported')
      await svc.check(true)
      expect(svc.install()).toBe(false)
      expect(updater.checks).toBe(0)
    }
  })

  it('notas do release viram texto simples e curto', () => {
    expect(notesToText(undefined)).toBeUndefined()
    expect(notesToText([{ note: '<p>A &amp; B</p>' }, { note: 'C' }])).toBe('A & B\n\nC')
    expect(notesToText('x'.repeat(5000))!.length).toBe(1500)
  })
})
