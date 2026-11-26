// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isRiftGame } from '../src/shared/poolImport'
import { parseGame, readAccount } from '../src/main/lcu/accountPool'
import { PostGameStore } from '../src/main/postgame/store'
import { PostGameCollector } from '../src/main/postgame/collector'
import { analyzeMatch } from '../src/shared/postgame'
import { normalizeMatch } from '../src/main/postgame/normalize'
import { makeLcuMatch } from './fixtures/match'

const tmp = () => mkdtempSync(path.join(tmpdir(), 'modes-'))

describe('só a Summoner\'s Rift conta', () => {
  it('reconhece as filas que entram', () => {
    for (const q of [400, 420, 430, 440, 490, 700]) expect(isRiftGame(q)).toBe(true)
    for (const q of [450, 1700, 900, 830, 1020]) expect(isRiftGame(q)).toBe(false)
    expect(isRiftGame(0, 'CLASSIC')).toBe(true)
    expect(isRiftGame(0, 'ARAM')).toBe(false)
  })

  it('o Pós-jogo não analisa ARAM nem remake', async () => {
    const fx = makeLcuMatch()
    const aram = { ...fx, game: { ...fx.game, queueId: 450, gameMode: 'ARAM' }, eog: { ...fx.eog, queueId: 450, gameMode: 'ARAM' } }
    const get = (f: typeof fx) => async (p: string) => {
      if (p.startsWith('/lol-end-of-game')) return { status: 200, data: f.eog }
      if (p.startsWith('/lol-summoner')) return { status: 200, data: { puuid: 'x', summonerId: 1, displayName: 'Pedro' } }
      if (p.includes('/games/')) return { status: 200, data: f.game }
      if (p.includes('/game-timelines/')) return { status: 200, data: f.timeline }
      return { status: 404, data: null }
    }
    const dir = tmp()
    const store = new PostGameStore(path.join(dir, 'h.json'), path.join(dir, 'raw'))
    const c = new PostGameCollector({ get: get(aram), store, champKeyOf: () => null, onReady: () => {}, sleep: async () => {}, attempts: 2 })
    const res = await c.collect()
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/Summoner/)
    expect(await store.list()).toHaveLength(0)

    const remake = { ...fx, game: { ...fx.game, gameDuration: 200 }, eog: { ...fx.eog } }
    const c2 = new PostGameCollector({ get: get(remake), store, champKeyOf: () => null, onReady: () => {}, sleep: async () => {}, attempts: 2 })
    expect((await c2.collect()).ok).toBe(false)
  })

  it('histórico antigo com ARAM some da lista', async () => {
    const dir = tmp()
    const fx = makeLcuMatch()
    const rift = normalizeMatch(fx)!
    const aram = { ...rift, gameId: 99, queueId: 450, mode: 'ARAM' }
    const mk = (r: typeof rift) => ({ report: r, analysis: analyzeMatch(r)!, savedAt: 1 })
    writeFileSync(path.join(dir, 'h.json'), JSON.stringify({ version: 1, items: [mk(aram), mk(rift)] }))
    const store = new PostGameStore(path.join(dir, 'h.json'), path.join(dir, 'raw'))
    expect((await store.list()).map((s) => s.gameId)).toEqual([rift.gameId])
  })
})

describe('Treino: contagem de partidas', () => {
  const g = (gameId: number, extra: Record<string, unknown> = {}) => ({ gameId, queueId: 420, gameDuration: 1500, participants: [{ championId: 103, stats: { win: true }, timeline: { role: 'SOLO', lane: 'MIDDLE' } }], ...extra })

  it('remake e modos fora da Rift não contam', () => {
    expect(parseGame(g(1))).toMatchObject({ gameId: 1, championId: 103 })
    expect(parseGame(g(2, { gameDuration: 200 }))).toBeNull()
    expect(parseGame(g(3, { queueId: 450 }))).toBeNull()
  })

  it('a partida repetida na fronteira entre páginas conta uma vez só', async () => {
    const page = (ids: number[]) => ({ games: { games: ids.map((i) => g(i)) } })
    const full = Array.from({ length: 20 }, (_, i) => i + 1)
    const get = async (p: string) => {
      if (p.startsWith('/lol-summoner')) return { status: 200, data: { gameName: 'Pedro', tagLine: 'BR1' } }
      if (p.includes('begIndex=0')) return { status: 200, data: page(full) }
      if (p.includes('begIndex=20')) return { status: 200, data: page([20, 21, 22]) } // o 20 veio de novo
      return { status: 404, data: null }
    }
    const r = await readAccount(get)
    expect(r.ok && r.games.length).toBe(22)
  })
})
