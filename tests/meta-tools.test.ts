// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acceptMatch,
  addMatch,
  extractPurchases,
  finalize,
  extractSkillSequence,
  fillLevels,
  isValidSkillSequence,
  itemRulesFrom,
  newState,
  priorityOf,
  runeKeyOf,
  spellKeyOf,
  type RawEvent,
  type RawMatch
} from '../tools/meta/aggregate'
import { RiotAuthError, RiotClient } from '../tools/meta/riot'
import { buildMeta, type BuildMetaOptions } from '../tools/meta/run'
import { validateDataset } from '../src/main/data/meta'

const FULL = 'QWEQQRQEQEREEWWRWW' // 18 níveis válidos: Q maxa primeiro, depois E, depois W

// --------------------------------------------------------------------------- agregador

describe('habilidades', () => {
  it('aceita uma sequência possível e calcula a prioridade', () => {
    expect(isValidSkillSequence(FULL)).toBe(true)
    expect(priorityOf(FULL)).toBe('RQEW')
  })

  it('rejeita o que o jogo não permite', () => {
    expect(isValidSkillSequence('QWEQR')).toBe(false) // ultimate no nível 5
    expect(isValidSkillSequence('QQQ')).toBe(false) // 3 pontos em Q no nível 3 (máx. 2)
    expect(isValidSkillSequence(FULL + 'Q')).toBe(false) // 19 níveis
    expect(isValidSkillSequence('QWEQQRQEQEREEWWRWWR')).toBe(false)
    expect(isValidSkillSequence('QWEX')).toBe(false)
  })

  it('colapsa cópias idênticas da timeline e descarta o jogador se sobrar evento fantasma', () => {
    const ev = (slot: number, t: number, extra: Partial<RawEvent> = {}): RawEvent => ({
      type: 'SKILL_LEVEL_UP', participantId: 3, skillSlot: slot, levelUpType: 'NORMAL', timestamp: t, ...extra
    })
    const events = [...FULL].map((k, i) => ev('QWER'.indexOf(k) + 1, 1000 * (i + 1)))

    const withCopy = [events[0], events[0], ...events.slice(1)] // cópia idêntica
    expect(extractSkillSequence(withCopy, 3)).toBe(FULL)

    const withEvolve = [...events, ev(4, 99_999, { levelUpType: 'EVOLVE' })] // evolução não é nível
    expect(extractSkillSequence(withEvolve, 3)).toBe(FULL)

    const withGhost = [...events, ev(1, 2_000_000)] // 19º nível, segundos depois: impossível
    expect(extractSkillSequence(withGhost, 3)).toBeNull()

    expect(extractSkillSequence(events, 4)).toBeNull() // outro jogador: nada
  })

  it('completa os níveis finais respeitando as regras', () => {
    expect(fillLevels('QWEQQRQEQ', 'RQEW')).toBe(FULL)
    for (const [prefix, prio] of [['EWQEERE', 'RWEQ'], ['WEQWWRWQW', 'RWQE']] as const) {
      const filled = fillLevels(prefix, prio)
      expect(filled).toHaveLength(18)
      expect(isValidSkillSequence(filled)).toBe(true)
    }
  })
})

describe('itens e partidas', () => {
  const itemJson = {
    data: {
      '1056': { gold: { total: 400, purchasable: true }, tags: [], maps: { '11': true } },
      '2003': { gold: { total: 50, purchasable: true }, tags: ['Consumable'], maps: { '11': true } },
      '3006': { gold: { total: 900 }, tags: ['Boots'], into: ['3020'], maps: { '11': true } }, // botas de nível 1
      '3020': { gold: { total: 1100 }, tags: ['Boots'], from: ['1001'], maps: { '11': true } },
      '3089': { gold: { total: 3600, purchasable: true }, tags: [], from: ['1026'], maps: { '11': true } },
      '3010': { gold: { total: 2000, purchasable: true }, tags: [], into: ['3040'], maps: { '11': true } }, // componente
      '9999': { gold: { total: 3000, purchasable: true }, tags: [], maps: { '11': false } } // só no ARAM
    }
  }

  it('separa itens completos e botas de nível 2', () => {
    const rules = itemRulesFrom(itemJson)
    expect([...rules.completed]).toEqual([3089])
    expect([...rules.boots]).toEqual([3020])
  })

  it('desfaz compras (ITEM_UNDO)', () => {
    const events: RawEvent[] = [
      { type: 'ITEM_PURCHASED', participantId: 1, itemId: 1056, timestamp: 0 },
      { type: 'ITEM_PURCHASED', participantId: 1, itemId: 3089, timestamp: 100 },
      { type: 'ITEM_UNDO', participantId: 1, beforeId: 3089, afterId: 0, timestamp: 110 },
      { type: 'ITEM_PURCHASED', participantId: 2, itemId: 3020, timestamp: 50 }
    ]
    expect(extractPurchases(events, 1)).toEqual([{ itemId: 1056, t: 0 }])
  })

  it('ignora partidas que não servem', () => {
    const base = (info: object): RawMatch => ({
      info: {
        gameVersion: '16.20.1.1', queueId: 420, gameDuration: 1500, gameEndedInEarlySurrender: false,
        participants: Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, championId: i + 1, teamId: i < 5 ? 100 : 200, win: i < 5 })),
        ...info
      }
    })
    expect(acceptMatch(base({}), '16.20')).not.toBeNull()
    expect(acceptMatch(base({ queueId: 450 }), '16.20')).toBeNull()
    expect(acceptMatch(base({ gameEndedInEarlySurrender: true }), '16.20')).toBeNull()
    expect(acceptMatch(base({ gameDuration: 200 }), '16.20')).toBeNull()
    expect(acceptMatch(base({ gameVersion: '16.19.5.1' }), '16.20')).toBeNull()
    expect(acceptMatch(base({ participants: [] }), '16.20')).toBeNull()
    expect(addMatch(newState('16.20'), base({ queueId: 450 }), null, itemRulesFrom(itemJson))).toBe(false)
  })
})

describe('sinergia entre aliados', () => {
  it('conta cada dupla do mesmo time (em qualquer rota) e chega ao dataset validado', () => {
    const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
    const match = (blueWins: boolean): RawMatch => ({
      info: {
        gameVersion: '16.20.1.1', queueId: 420, gameDuration: 1500, gameEndedInEarlySurrender: false,
        participants: Array.from({ length: 10 }, (_, i) => ({
          participantId: i + 1, championId: i + 1, teamId: i < 5 ? 100 : 200, teamPosition: roles[i % 5], win: (i < 5) === blueWins
        }))
      }
    })
    const state = newState('16.20')
    const rules = itemRulesFrom({ data: {} })
    for (const blue of [true, true, false]) addMatch(state, match(blue), null, rules)

    // campeão 1 (topo, time azul) jogou 3x com o campeão 2 (selva) e ganhou 2
    expect(state.champions['1'].TOP!.synergies!['2']).toEqual({ games: 3, wins: 2 })
    expect(state.champions['1'].TOP!.synergies!['6']).toBeUndefined() // inimigo não é aliado
    expect(state.champions['6'].TOP!.synergies!['7']).toEqual({ games: 3, wins: 1 })

    const ds = finalize(state, { minGames: 1, minMatchupGames: 3, minBuildSamples: 1, source: 't', generatedAt: '' })
    expect(ds.champions['1'].roles.TOP!.synergies!['2']).toEqual({ games: 3, wins: 2 })
    const checked = validateDataset(JSON.parse(JSON.stringify(ds)))
    expect(checked.champions['1'].roles.TOP!.synergies!['5']).toEqual({ games: 3, wins: 2 })
  })

  it('checkpoint antigo (sem sinergias) continua funcionando', () => {
    const old = newState('16.20')
    old.champions['1'] = { TOP: { games: 1, wins: 1, matchups: {}, build: { samples: 0, priority: {}, skillPrefix: {}, starting: {}, boots: {}, core: {}, other: {} } } }
    const m: RawMatch = { info: { gameVersion: '16.20.1.1', queueId: 420, gameDuration: 1500, participants: Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, championId: i + 1, teamId: i < 5 ? 100 : 200, teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][i % 5], win: i < 5 })) } }
    expect(addMatch(old, m, null, itemRulesFrom({ data: {} }))).toBe(true)
    expect(old.champions['1'].TOP!.synergies!['2']).toEqual({ games: 1, wins: 1 })
  })
})

describe('runas e feitiços', () => {
  const perks = (style: number, sub: number, ids: number[]) => ({
    statPerks: { offense: ids[6], flex: ids[7], defense: ids[8] },
    styles: [
      { description: 'primaryStyle', style, selections: ids.slice(0, 4).map((perk) => ({ perk })) },
      { description: 'subStyle', style: sub, selections: ids.slice(4, 6).map((perk) => ({ perk })) }
    ]
  })
  const PAGE = [8112, 8139, 8138, 8135, 8226, 8210, 5008, 5008, 5001]

  it('lê a página de runas na ordem do cliente e rejeita páginas incompletas', () => {
    const p = { participantId: 1, championId: 1, teamId: 100, win: true, perks: perks(8100, 8200, PAGE) }
    expect(runeKeyOf(p)).toBe(`8100|8200|${PAGE.join(',')}`)
    expect(runeKeyOf({ ...p, perks: perks(8100, 8100, PAGE) })).toBeNull()
    expect(runeKeyOf({ ...p, perks: undefined })).toBeNull()
    expect(runeKeyOf({ ...p, perks: perks(8100, 8200, [...PAGE.slice(0, 8), 0]) })).toBeNull()
    expect(spellKeyOf({ ...p, summoner1Id: 14, summoner2Id: 4 })).toBe('4,14')
    expect(spellKeyOf({ ...p, summoner1Id: 4, summoner2Id: 4 })).toBeNull()
  })

  it('conta runas e feitiços só das vitórias', () => {
    const state = newState('16.20')
    for (let n = 0; n < 5; n++) {
      const m: RawMatch = {
        info: {
          gameVersion: '16.20.1.1',
          queueId: 420,
          gameDuration: 1500,
          participants: Array.from({ length: 10 }, (_, i) => ({
            participantId: i + 1,
            championId: i + 1,
            teamId: i < 5 ? 100 : 200,
            teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][i % 5],
            win: i < 5,
            summoner1Id: 4,
            summoner2Id: 14,
            perks: perks(8100, 8200, PAGE)
          }))
        }
      }
      addMatch(state, m, null, itemRulesFrom({ data: {} }))
    }
    // O perdedor (campeão 6) não entra na contagem
    expect(state.champions['6'].TOP!.build.runes).toBeUndefined()
    expect(Object.values(state.champions['1'].TOP!.build.runes!)).toEqual([5])
    const b = state.champions['1'].TOP!.build
    expect(Object.keys(b.spells!)).toEqual(['4,14'])
  })

  it('o app ignora runas fora do formato sem rejeitar o arquivo', () => {
    const build = (extra: object) => ({
      schemaVersion: 1,
      source: 't',
      patch: '16.20',
      generatedAt: '2026-01-01T00:00:00Z',
      champions: { '1': { roles: { TOP: { games: 10, wins: 5, matchups: {}, build: { ...extra, skillOrder: { priority: ['R', 'Q', 'W', 'E'] }, items: { starting: [], boots: [], core: [], situational: [] } } } } } }
    })
    const good = validateDataset(build({ runes: { primaryStyleId: 8100, subStyleId: 8200, perkIds: PAGE }, spells: [4, 14] }))
    expect(good.champions['1'].roles.TOP!.build!.runes!.perkIds).toEqual(PAGE)
    expect(good.champions['1'].roles.TOP!.build!.spells).toEqual([4, 14])
    const bad = validateDataset(build({ runes: { primaryStyleId: 8100, subStyleId: 8200, perkIds: [1, 2, 3] }, spells: [4, 4] }))
    expect(bad.champions['1'].roles.TOP!.build!.runes).toBeUndefined()
    expect(bad.champions['1'].roles.TOP!.build!.spells).toBeUndefined()
  })
})

describe('cliente da Riot', () => {
  const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })

  it('espera o Retry-After no 429 e tenta de novo; 404 vira null', async () => {
    const waits: number[] = []
    const seq = [new Response('', { status: 429, headers: { 'retry-after': '3' } }), ok({ a: 1 }), new Response('', { status: 404 })]
    const client = new RiotClient({
      apiKey: 'RGAPI-x', platformBase: 'http://x', regionalBase: 'http://x', rps: 1000,
      fetchFn: (async () => seq.shift() as Response) as unknown as typeof fetch,
      sleep: async (ms) => void waits.push(ms)
    })
    expect(await client.get('platform', '/p')).toEqual({ a: 1 })
    expect(waits).toContain(3000)
    expect(await client.get('platform', '/q')).toBeNull()
  })

  it('chave recusada é erro definitivo e a mensagem não vaza a chave', async () => {
    const client = new RiotClient({
      apiKey: 'RGAPI-segredo', platformBase: 'http://x', regionalBase: 'http://x', rps: 1000,
      fetchFn: (async () => new Response('', { status: 403 })) as unknown as typeof fetch,
      sleep: async () => undefined
    })
    const err = await client.get('platform', '/p').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RiotAuthError)
    expect((err as Error).message).not.toContain('segredo')
  })
})

// --------------------------------------------------------------- ponta a ponta (Riot simulada)

const KEY = 'RGAPI-teste'
const ITEMS = itemRulesFrom({
  data: {
    '1056': { gold: { total: 400 }, tags: [], maps: { '11': true } },
    '2003': { gold: { total: 50 }, tags: ['Consumable'], maps: { '11': true } },
    '3020': { gold: { total: 1100 }, tags: ['Boots'], from: ['1001'], maps: { '11': true } },
    '6655': { gold: { total: 3000 }, tags: [], maps: { '11': true } },
    '4645': { gold: { total: 2800 }, tags: [], maps: { '11': true } },
    '3089': { gold: { total: 3600 }, tags: [], maps: { '11': true } },
    '3157': { gold: { total: 3000 }, tags: [], maps: { '11': true } },
    '3102': { gold: { total: 2900 }, tags: [], maps: { '11': true } }
  }
})
void ITEMS

const TEAM_A: [number, string][] = [[266, 'TOP'], [64, 'JUNGLE'], [103, 'MIDDLE'], [22, 'BOTTOM'], [412, 'UTILITY']]
const TEAM_B: [number, string][] = [[54, 'TOP'], [254, 'JUNGLE'], [238, 'MIDDLE'], [51, 'BOTTOM'], [117, 'UTILITY']]

function matchBody(n: number): RawMatch {
  const aWins = n % 2 === 1 // M1, M3, M5: time A vence
  const remake = n === 7
  return {
    info: {
      gameVersion: n === 6 ? '16.19.4.1' : '16.20.612.4409',
      queueId: 420,
      gameDuration: remake ? 200 : 1700,
      gameEndedInEarlySurrender: remake,
      participants: [...TEAM_A.map((c, i) => ({ c, i, team: 100 })), ...TEAM_B.map((c, i) => ({ c, i, team: 200 }))].map((x, idx) => ({
        participantId: idx + 1,
        championId: x.c[0],
        teamId: x.team,
        teamPosition: x.c[1],
        win: x.team === 100 ? aWins : !aWins
      }))
    }
  }
}

function timelineBody(n: number): object {
  const events: object[] = []
  for (let pid = 1; pid <= 10; pid++) {
    ;[...FULL].forEach((k, i) =>
      events.push({ type: 'SKILL_LEVEL_UP', participantId: pid, skillSlot: 'QWER'.indexOf(k) + 1, levelUpType: 'NORMAL', timestamp: 60_000 * (i + 1) + pid })
    )
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 1056, timestamp: 0 })
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 2003, timestamp: 5_000 })
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 3020, timestamp: 400_000 })
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 6655, timestamp: 500_000 })
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 3102, timestamp: 600_000 })
    events.push({ type: 'ITEM_UNDO', participantId: pid, beforeId: 3102, afterId: 0, timestamp: 601_000 })
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 4645, timestamp: 900_000 })
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 3089, timestamp: 1_300_000 })
    events.push({ type: 'ITEM_PURCHASED', participantId: pid, itemId: 3157, timestamp: 1_600_000 })
  }
  // M1: cópia idêntica de um evento da Ahri (pid 3). M3: evento fantasma extra (19º nível) da Ahri.
  if (n === 1) events.push({ type: 'SKILL_LEVEL_UP', participantId: 3, skillSlot: 1, levelUpType: 'NORMAL', timestamp: 60_000 + 3 })
  if (n === 3) events.push({ type: 'SKILL_LEVEL_UP', participantId: 3, skillSlot: 2, levelUpType: 'NORMAL', timestamp: 1_300_000 })
  return { info: { frames: [{ events }] } }
}

interface Mock {
  server: Server
  base: string
  hits: string[]
  headers: (string | undefined)[]
  queries: URLSearchParams[]
  mode: { auth403: boolean; rateLimitOnce: boolean }
}

async function startMock(): Promise<Mock> {
  const mock = { hits: [] as string[], headers: [] as (string | undefined)[], queries: [] as URLSearchParams[], mode: { auth403: false, rateLimitOnce: false } } as Mock
  let limited = false
  mock.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const p = url.pathname
    if (!p.startsWith('/api/') && !p.startsWith('/cdn/')) {
      mock.headers.push(req.headers['x-riot-token'] as string | undefined)
      mock.queries.push(url.searchParams)
    }
    mock.hits.push(p)
    const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }
    if (p === '/api/versions.json') return send(200, ['16.20.1', '16.19.1'])
    if (p.startsWith('/cdn/16.20.1/data/en_US/item.json'))
      return send(200, {
        data: {
          '1056': { gold: { total: 400, purchasable: true }, tags: [], maps: { '11': true } },
          '2003': { gold: { total: 50 }, tags: ['Consumable'], maps: { '11': true } },
          '3020': { gold: { total: 1100 }, tags: ['Boots'], from: ['1001'], maps: { '11': true } },
          '6655': { gold: { total: 3000 }, tags: [], maps: { '11': true } },
          '4645': { gold: { total: 2800 }, tags: [], maps: { '11': true } },
          '3089': { gold: { total: 3600 }, tags: [], maps: { '11': true } },
          '3157': { gold: { total: 3000 }, tags: [], maps: { '11': true } },
          '3102': { gold: { total: 2900 }, tags: [], maps: { '11': true } }
        }
      })
    if (mock.mode.auth403) return send(403, {})
    if (mock.mode.rateLimitOnce && !limited && p.endsWith('/RANKED_SOLO_5x5')) {
      limited = true
      return send(429, {}, { 'retry-after': '2' })
    }
    if (p === '/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5') return send(200, { entries: [{ puuid: 'p1' }, { puuid: 'p2' }, { puuid: 'p3' }] })
    if (p === '/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5') return send(200, { entries: [] })
    if (p === '/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5') return send(200, { entries: [{ summonerId: 's9' }] })
    if (p === '/lol/summoner/v4/summoners/s9') return send(200, { puuid: 'p4' })
    const ids: Record<string, string[]> = { p1: ['BR1_1', 'BR1_2', 'BR1_3'], p2: ['BR1_3', 'BR1_4', 'BR1_5'], p3: ['BR1_6', 'BR1_7'], p4: [] }
    const byPuuid = p.match(/^\/lol\/match\/v5\/matches\/by-puuid\/([^/]+)\/ids$/)
    if (byPuuid) return send(200, ids[byPuuid[1]] ?? [])
    const tl = p.match(/^\/lol\/match\/v5\/matches\/BR1_(\d+)\/timeline$/)
    if (tl) return send(200, timelineBody(Number(tl[1])))
    const m = p.match(/^\/lol\/match\/v5\/matches\/BR1_(\d+)$/)
    if (m) return send(200, matchBody(Number(m[1])))
    return send(404, {})
  })
  await new Promise<void>((r) => mock.server.listen(0, '127.0.0.1', r))
  mock.base = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}`
  return mock
}

describe('buildMeta (Riot simulada)', () => {
  let mock: Mock
  let dir: string
  const waits: number[] = []

  beforeEach(async () => {
    mock = await startMock()
    dir = mkdtempSync(join(tmpdir(), 'meta-'))
    waits.length = 0
  })
  afterEach(() => new Promise<void>((r) => mock.server.close(() => r())))

  const options = (over: Partial<BuildMetaOptions> = {}): BuildMetaOptions => ({
    apiKey: KEY, platform: 'br1', tiers: ['challenger', 'grandmaster', 'master'], patch: 'auto',
    maxMatches: 100, matchesPerPlayer: 10, days: 14, rps: 1000,
    workDir: join(dir, 'work'), out: join(dir, 'meta.json'),
    minGames: 1, minMatchupGames: 1, minBuildSamples: 1, timeline: true, seed: 1,
    riotBase: mock.base, ddragonBase: mock.base,
    sleep: async (ms) => void waits.push(ms),
    ...over
  })

  it('gera um dataset válido com winrates, confrontos e build', async () => {
    const ds = await buildMeta(options())
    expect(ds.patch).toBe('16.20')
    expect(ds.source).toBe('Riot Match-v5 (br1), 5 partidas') // M6 (outro patch) e M7 (remake) ficaram de fora

    const ahri = ds.champions['103'].roles.MIDDLE!
    expect(ahri.games).toBe(5)
    expect(ahri.wins).toBe(3)
    expect(ahri.matchups['238']).toEqual({ games: 5, wins: 3 })
    expect(ds.champions['238'].roles.MIDDLE!.matchups['103']).toEqual({ games: 5, wins: 2 })

    const build = ahri.build!
    expect(build.skillOrder.priority).toEqual(['R', 'Q', 'E', 'W'])
    expect(build.skillOrder.levels?.join('')).toBe(FULL)
    expect(build.items.starting).toEqual([1056, 2003])
    expect(build.items.boots).toEqual([3020])
    expect(build.items.core).toEqual([6655, 4645, 3089])
    expect(build.items.situational.map((s) => s.itemId)).toEqual([3157]) // o 3102 foi desfeito
    expect(build.items.situational[0].when).toMatch(/100%/)

    // o arquivo gravado passa na mesma validação do app
    expect(validateDataset(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))).patch).toBe('16.20')
  })

  it('usa os parâmetros certos, envia a chave e conta cada partida uma única vez', async () => {
    await buildMeta(options())
    expect(mock.headers.every((h) => h === KEY)).toBe(true)
    const ids = mock.queries.find((q) => q.has('queue'))!
    expect(ids.get('queue')).toBe('420')
    expect(ids.get('type')).toBe('ranked')
    expect(mock.hits.filter((p) => p === '/lol/match/v5/matches/BR1_3')).toHaveLength(1) // aparece em dois jogadores
    // timeline só das partidas contadas (M6 e M7 não pedem)
    expect(mock.hits.filter((p) => p.endsWith('/timeline'))).toHaveLength(5)
  })

  it('retoma do checkpoint sem recontar nem rebaixar partidas', async () => {
    // A ordem dos jogadores é embaralhada (semente fixa), então o teste não assume quais partidas vêm primeiro.
    const matchHits = (): string[] => mock.hits.filter((p) => /\/lol\/match\/v5\/matches\/BR1_\d+$/.test(p))

    const first = await buildMeta(options({ maxMatches: 2 }))
    expect(first.source).toBe('Riot Match-v5 (br1), 2 partidas')
    expect(existsSync(join(dir, 'work', 'state-v2-br1-16.20.json'))).toBe(true)
    const downloadedFirst = matchHits()
    expect(downloadedFirst.length).toBeGreaterThanOrEqual(2)

    mock.hits.length = 0
    const second = await buildMeta(options({ maxMatches: 100 }))
    expect(second.source).toBe('Riot Match-v5 (br1), 5 partidas')
    const downloadedSecond = matchHits()
    for (const p of downloadedSecond) expect(downloadedFirst).not.toContain(p) // nada baixado de novo
    // somando as duas execuções, cada partida foi baixada uma única vez (BR1_3 aparece em dois jogadores)
    expect(new Set([...downloadedFirst, ...downloadedSecond]).size).toBe(downloadedFirst.length + downloadedSecond.length)

    mock.hits.length = 0
    await buildMeta(options({ maxMatches: 100 }))
    expect(mock.hits.filter((p) => p.includes('/lol/match/v5/matches/BR1_'))).toHaveLength(0)
  })

  it('segue depois de um 429 e usa o summonerId quando o ladder não traz puuid', async () => {
    mock.mode.rateLimitOnce = true
    const ds = await buildMeta(options())
    expect(waits).toContain(2000)
    expect(mock.hits).toContain('/lol/summoner/v4/summoners/s9')
    expect(ds.source).toBe('Riot Match-v5 (br1), 5 partidas')
  })

  it('sem timelines, gera estatísticas mas nenhuma build', async () => {
    const ds = await buildMeta(options({ timeline: false }))
    expect(ds.champions['103'].roles.MIDDLE!.build).toBeUndefined()
    expect(ds.champions['103'].roles.MIDDLE!.games).toBe(5)
    expect(mock.hits.some((p) => p.endsWith('/timeline'))).toBe(false)
  })

  it('chave recusada interrompe com mensagem clara', async () => {
    mock.mode.auth403 = true
    await expect(buildMeta(options())).rejects.toBeInstanceOf(RiotAuthError)
  })

  it('--finalize-only refaz o arquivo a partir do checkpoint sem tocar na Riot', async () => {
    await buildMeta(options())
    mock.hits.length = 0
    const ds = await buildMeta(options({ finalizeOnly: true, apiKey: '', minGames: 6 })) // 6 > 5 jogos: tudo filtrado
    expect(Object.keys(ds.champions)).toHaveLength(0)
    expect(mock.hits.filter((p) => p.startsWith('/lol/'))).toHaveLength(0)
  })

  it('interrupção (Ctrl+C) gera o arquivo com o que já foi coletado e a retomada completa o resto', async () => {
    // Ctrl+C no 3º download de partida (a ordem dos jogadores é embaralhada, então não dá para apontar uma partida fixa).
    // No máximo 2 das 7 partidas são descartadas (outro patch e remake), logo ao menos 1 foi contada.
    const controller = new AbortController()
    const downloaded: string[] = []
    const aborting = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      if (/\/lol\/match\/v5\/matches\/BR1_\d+$/.test(url)) {
        downloaded.push(url)
        if (downloaded.length === 3) controller.abort()
      }
      return fetch(input, init)
    }) as typeof fetch

    const partial = await buildMeta(options({ signal: controller.signal, fetchFn: aborting }))
    expect(downloaded).toHaveLength(3) // parou logo depois do Ctrl+C
    const counted = Number(/(\d+) partidas/.exec(partial.source)?.[1])
    expect(counted).toBeGreaterThanOrEqual(1)
    expect(counted).toBeLessThan(5)
    expect(existsSync(join(dir, 'meta.json'))).toBe(true) // gerou o arquivo com o que tinha

    mock.hits.length = 0
    const full = await buildMeta(options())
    expect(full.source).toBe('Riot Match-v5 (br1), 5 partidas')
    expect(full.champions['103'].roles.MIDDLE!.games).toBe(5) // nada contado em dobro
    const again = mock.hits.filter((p) => /\/lol\/match\/v5\/matches\/BR1_\d+$/.test(p)).map((p) => `${mock.base}${p}`)
    for (const url of again) expect(downloaded).not.toContain(url) // não rebaixou o que já tinha
  })

  it('sem nenhuma partida válida, avisa em vez de gerar um arquivo vazio', async () => {
    await expect(buildMeta(options({ patch: '15.1' }))).rejects.toThrow(/Nenhuma partida válida/)
    expect(existsSync(join(dir, 'meta.json'))).toBe(false)
  })
})
