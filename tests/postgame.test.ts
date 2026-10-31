// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { analyzeMatch, gradeOf } from '../src/shared/postgame'
import { findGameIds, normalizeMatch } from '../src/main/postgame/normalize'
import { PostGameStore } from '../src/main/postgame/store'
import { PostGameCollector } from '../src/main/postgame/collector'
import { makeLcuMatch } from './fixtures/match'

describe('normalizeMatch', () => {
  it('lê participantes, rotas, timeline e eventos do formato do cliente', () => {
    const raw = makeLcuMatch()
    const r = normalizeMatch(raw)!
    expect(r.gameId).toBe(7000000001)
    expect(r.participants).toHaveLength(10)
    const me = r.participants.find((p) => p.isMe)!
    expect(me).toMatchObject({ id: 1, role: 'TOP', teamId: 100, kills: 5, deaths: 2, assists: 7, win: true })
    expect(r.participants.find((p) => p.id === 5)!.role).toBe('UTILITY') // DUO_SUPPORT
    expect(r.participants.find((p) => p.id === 4)!.role).toBe('BOTTOM') // DUO_CARRY
    expect(r.durationSec).toBe(25 * 60)
    expect(r.hasTimeline).toBe(true)
    expect(r.frames).toHaveLength(26)
    expect(r.frames[10].players[1].cs).toBe(75)
    const dragon = r.events.find((e) => e.kind === 'DRAGON')!
    expect(dragon).toMatchObject({ teamId: 100, actorId: 2, assists: [1, 3] })
    const tower = r.events.find((e) => e.kind === 'TOWER')!
    expect(tower.teamId).toBe(100) // a torre destruída era do 200
    expect(r.events.filter((e) => e.kind === 'KILL')).toHaveLength(3)
  })

  it('funciona só com o placar final (sem detalhes nem timeline)', () => {
    const { eog, me } = makeLcuMatch()
    const r = normalizeMatch({ eog, me })!
    expect(r.participants).toHaveLength(10)
    expect(r.hasTimeline).toBe(false)
    expect(r.participants.filter((p) => p.isMe)).toHaveLength(1) // achado pelo campeão do jogador local
    expect(analyzeMatch(r)).not.toBeNull()
  })

  it('completa rotas ausentes pelo campeão e aceita campos no estilo Match-v5', () => {
    const { game } = makeLcuMatch()
    const v5 = {
      ...game,
      participantIdentities: undefined,
      participants: game.participants.map((p) => ({
        participantId: p.participantId,
        teamId: p.teamId,
        championId: p.championId,
        puuid: p.participantId === 1 ? 'puuid-pedro' : `puuid-${p.participantId}`,
        riotIdGameName: p.participantId === 1 ? 'Pedro' : `J${p.participantId}`,
        teamPosition: p.participantId === 1 ? 'TOP' : '',
        ...p.stats
      }))
    }
    const r = normalizeMatch({ game: v5, me: { name: 'Pedro' } }, { champKeyOf: (id) => ({ 64: 'LeeSin', 103: 'Ahri', 22: 'Ashe', 412: 'Thresh' }[id] ?? null) })!
    expect(r.participants.find((p) => p.isMe)!.id).toBe(1)
    const blue = r.participants.filter((p) => p.teamId === 100)
    expect(new Set(blue.map((p) => p.role)).size).toBe(5) // nenhuma rota repetida ou faltando
    expect(blue.find((p) => p.championId === 64)!.role).toBe('JUNGLE')
    expect(blue.find((p) => p.championId === 412)!.role).toBe('UTILITY')
  })

  it('devolve null com dados vazios e não quebra com lixo', () => {
    expect(normalizeMatch({})).toBeNull()
    expect(normalizeMatch({ game: 'x', eog: 42, timeline: [] })).toBeNull()
    const { game, me } = makeLcuMatch()
    const r = normalizeMatch({ game, timeline: { frames: 'quebrado' }, me })!
    expect(r.hasTimeline).toBe(false)
  })

  it('findGameIds acha ids em qualquer formato de lista', () => {
    expect(findGameIds({ games: { games: [{ gameId: 5 }, { gameId: 4 }] } })).toEqual([5, 4])
    expect(findGameIds([{ metadata: { x: 1 }, gameId: 9 }], 1)).toEqual([9])
    expect(findGameIds(null)).toEqual([])
  })
})

describe('analyzeMatch', () => {
  it('calcula diferenças para o oponente, fases e objetivos', () => {
    const r = normalizeMatch(makeLcuMatch())!
    const a = analyzeMatch(r)!
    expect(a.role).toBe('TOP')
    expect(a.opponentId).toBe(6)
    expect(a.csPerMin).toBeGreaterThan(7)
    const d10 = a.diffs.find((d) => d.minute === 10)!
    expect(d10.cs).toBe(Math.round(10 * 7.5) - Math.round(10 * 7)) // 75 - 70
    expect(d10.gold).toBe(Math.round(10 * 520) - Math.round(10 * 480))
    expect(a.phases[0]).toMatchObject({ kills: 1, deaths: 1 })
    expect(a.killParticipation).toBeCloseTo(12 / 17, 2) // (5+7) / (5+3*4)
    const dragons = a.objectives.find((o) => o.kind === 'DRAGON')!
    expect(dragons).toMatchObject({ team: 1, enemy: 0, mine: 1 })
    expect(a.objectives.find((o) => o.kind === 'BARON')!.mine).toBe(1)
    expect(a.minutes).toHaveLength(26)
    expect(a.teamGoldDiff[25]).toBeGreaterThan(0)
    expect(a.score).toBeGreaterThanOrEqual(0)
    expect(a.score).toBeLessThanOrEqual(100)
    expect(a.components.map((c) => c.key)).toEqual(expect.arrayContaining(['farm', 'laning', 'fighting', 'vision', 'survival']))
  })

  it('um jogo ruim nota menos e gera dicas de farm e mortes', () => {
    const good = analyzeMatch(normalizeMatch(makeLcuMatch({ myCsPerMin: 8, myDeaths: 1 }))!)!
    const bad = analyzeMatch(normalizeMatch(makeLcuMatch({ myCsPerMin: 4, myDeaths: 11 }))!)!
    expect(bad.score).toBeLessThan(good.score)
    expect(bad.insights.some((i) => i.title === 'Farm abaixo do esperado' && i.level === 'bad')).toBe(true)
    expect(bad.insights.some((i) => i.title === 'Muitas mortes no jogo')).toBe(true)
    expect(good.insights.some((i) => i.title === 'Farm forte')).toBe(true)
    expect(good.insights[0].level).not.toBe('info')
  })

  it('sem timeline avisa e ainda calcula com o placar', () => {
    const { eog, me } = makeLcuMatch()
    const a = analyzeMatch(normalizeMatch({ eog, me })!)!
    expect(a.minutes).toEqual([])
    expect(a.opp).toBeNull()
    expect(a.insights.some((i) => i.title === 'Sem a linha do tempo')).toBe(true)
  })

  it('retorna null se você não está na partida e faixa de notas', () => {
    const r = normalizeMatch(makeLcuMatch())!
    r.participants.forEach((p) => (p.isMe = false))
    expect(analyzeMatch(r)).toBeNull()
    expect([gradeOf(90), gradeOf(75), gradeOf(60), gradeOf(45), gradeOf(10)]).toEqual(['S', 'A', 'B', 'C', 'D'])
  })
})

describe('PostGameCollector + store', () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), 'pg-'))

  function fakeLcu(fx: ReturnType<typeof makeLcuMatch>, failFirst = 0) {
    let calls = 0
    const log: string[] = []
    const get = async (p: string) => {
      log.push(p)
      if (p.startsWith('/lol-end-of-game')) return { status: 200, data: fx.eog }
      if (p.startsWith('/lol-summoner')) return { status: 200, data: { puuid: 'puuid-pedro', summonerId: 111, displayName: 'Pedro' } }
      if (p.includes('/lol-match-history/v1/games/') || p.includes('/game-timelines/')) {
        calls++
        if (calls <= failFirst) return { status: 404, data: null } // o histórico demora a publicar
        return { status: 200, data: p.includes('/games/') ? fx.game : fx.timeline }
      }
      if (p.includes('matches') || p.includes('matchlist')) return { status: 200, data: { games: { games: [{ gameId: fx.game.gameId }] } } }
      return { status: 404, data: null }
    }
    return { get, log }
  }

  it('busca, tenta de novo até o histórico sair, analisa e guarda', async () => {
    const dir = tmp()
    const store = new PostGameStore(path.join(dir, 'h.json'), path.join(dir, 'raw'))
    const fx = makeLcuMatch()
    const { get } = fakeLcu(fx, 2)
    const ready = vi.fn()
    const c = new PostGameCollector({ get, store, champKeyOf: () => null, onReady: ready, sleep: async () => {}, attempts: 5 })
    const res = await c.collect()
    expect(res).toMatchObject({ ok: true, gameId: fx.game.gameId })
    expect(ready).toHaveBeenCalledTimes(1)
    const detail = await store.get(fx.game.gameId)
    expect(detail!.report.hasTimeline).toBe(true)
    expect((await store.list())[0]).toMatchObject({ gameId: fx.game.gameId, championId: 266, role: 'TOP', win: true })

    // chamar de novo não refaz o trabalho
    ready.mockClear()
    await c.collect()
    expect(ready).not.toHaveBeenCalled()

    // histórico persiste entre execuções
    const again = new PostGameStore(path.join(dir, 'h.json'), path.join(dir, 'raw'))
    expect(await again.list()).toHaveLength(1)
  })

  it('se o cliente nunca entregar os detalhes, salva só com o placar final', async () => {
    const dir = tmp()
    const store = new PostGameStore(path.join(dir, 'h.json'), path.join(dir, 'raw'))
    const fx = makeLcuMatch()
    const { get } = fakeLcu(fx, 999)
    const c = new PostGameCollector({ get, store, champKeyOf: () => null, onReady: () => {}, sleep: async () => {}, attempts: 3 })
    const res = await c.collect()
    expect(res.ok).toBe(true)
    expect(res.message).toMatch(/placar final/)
    expect((await store.get(fx.game.gameId))!.report.hasTimeline).toBe(false)
    // depois, "analisar última partida" completa com a timeline
    const ok = fakeLcu(fx, 0)
    const c2 = new PostGameCollector({ get: ok.get, store, champKeyOf: () => null, onReady: () => {}, sleep: async () => {}, attempts: 3 })
    expect((await c2.collectLatest()).ok).toBe(true)
    expect((await store.get(fx.game.gameId))!.report.hasTimeline).toBe(true)
  })

  it('sem resultado do cliente devolve mensagem clara, e o cliente fechado não derruba', async () => {
    const dir = tmp()
    const store = new PostGameStore(path.join(dir, 'h.json'), path.join(dir, 'raw'))
    const c = new PostGameCollector({
      get: async () => {
        throw new Error('LCU não conectada')
      },
      store,
      champKeyOf: () => null,
      onReady: () => {},
      sleep: async () => {},
      attempts: 2
    })
    expect((await c.collect()).ok).toBe(false)
    expect((await c.collectLatest()).ok).toBe(false)
  })

  it('a fase de fim de jogo dispara a coleta uma vez por vez', async () => {
    const dir = tmp()
    const store = new PostGameStore(path.join(dir, 'h.json'), path.join(dir, 'raw'))
    const fx = makeLcuMatch()
    const { get } = fakeLcu(fx)
    const ready = vi.fn()
    const c = new PostGameCollector({ get, store, champKeyOf: () => null, onReady: ready, sleep: async () => {}, attempts: 3 })
    c.onPhase('InProgress')
    c.onPhase('WaitingForStats')
    c.onPhase('EndOfGame') // enquanto busca, ignora
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('o histórico guarda no máximo 40 e apaga', async () => {
    const dir = tmp()
    const store = new PostGameStore(path.join(dir, 'h.json'), path.join(dir, 'raw'))
    const base = normalizeMatch(makeLcuMatch())!
    const a = analyzeMatch(base)!
    for (let i = 1; i <= 45; i++) await store.put({ ...base, gameId: i }, { ...a, gameId: i })
    const list = await store.list()
    expect(list).toHaveLength(40)
    expect(list[0].gameId).toBe(45)
    await store.remove(45)
    expect(await store.has(45)).toBe(false)
  })
})

describe('rotas quando o cliente não informa', () => {
  const keys: Record<number, string> = { 266: 'Aatrox', 64: 'LeeSin', 103: 'Ahri', 22: 'Ashe', 412: 'Thresh', 54: 'Malphite', 11: 'MasterYi', 7: 'Leblanc', 51: 'Caitlyn', 111: 'Nautilus' }
  const champKeyOf = (id: number) => keys[id] ?? null

  it('descobre as 5 rotas de cada time pelo mapa, Golpe-fatal e farm', () => {
    const r = normalizeMatch(makeLcuMatch({ hideRoles: true, me: 5 }), { champKeyOf })!
    for (const team of [100, 200]) {
      const roles = r.participants.filter((p) => p.teamId === team).map((p) => p.role)
      expect([...roles].sort()).toEqual(['BOTTOM', 'JUNGLE', 'MIDDLE', 'TOP', 'UTILITY'])
    }
    expect(r.participants.find((p) => p.id === 2)!.role).toBe('JUNGLE')
    expect(r.participants.find((p) => p.id === 5)!.role).toBe('UTILITY')
    expect(r.participants.find((p) => p.id === 10)!.role).toBe('UTILITY')
  })

  it('funciona mesmo sem a tabela de campeões (só sinais do jogo)', () => {
    const r = normalizeMatch(makeLcuMatch({ hideRoles: true, me: 5 }))!
    expect(r.participants.find((p) => p.id === 5)!.role).toBe('UTILITY')
    expect(r.participants.find((p) => p.id === 4)!.role).toBe('BOTTOM')
    expect(r.participants.find((p) => p.id === 8)!.role).toBe('MIDDLE')
  })

  it('suporte é comparado com o suporte inimigo, nunca com outra rota', () => {
    const r = normalizeMatch(makeLcuMatch({ hideRoles: true, me: 5 }), { champKeyOf })!
    const a = analyzeMatch(r)!
    expect(a.role).toBe('UTILITY')
    expect(a.opponentId).toBe(10)
    expect(a.diffs.length).toBeGreaterThan(0)
  })

  it('rotas informadas corretamente pelo cliente são mantidas', () => {
    const r = normalizeMatch(makeLcuMatch({ me: 5 }))!
    expect(r.participants.find((p) => p.isMe)!.role).toBe('UTILITY')
    expect(analyzeMatch(r)!.opponentId).toBe(10)
  })
})
