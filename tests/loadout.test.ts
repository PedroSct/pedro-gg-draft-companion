// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { LcuConnector } from '../src/main/lcu/connector'
import { applyLoadout, itemSetFor, type LoadoutInput } from '../src/main/lcu/loadout'
import type { ChampionBuild } from '../src/shared/dataTypes'

const build: ChampionBuild = {
  runes: { primaryStyleId: 8100, subStyleId: 8200, perkIds: [8112, 8139, 8138, 8135, 8226, 8210, 5008, 5008, 5001] },
  spells: [4, 14],
  skillOrder: { priority: ['R', 'Q', 'W', 'E'] },
  items: { starting: [1056, 2003], boots: [3020], core: [6655, 4645, 3089], situational: [{ itemId: 3157, when: 'x' }] }
}
const input = (parts: Partial<LoadoutInput['parts']>): LoadoutInput => ({
  championId: 103,
  championName: 'Ahri',
  role: 'MIDDLE',
  build,
  parts: { runes: false, spells: false, items: false, ...parts }
})

let server: https.Server
let wss: WebSocketServer
let lockfile: string
const sockets = new Set<WebSocket>()
let calls: { method: string; url: string; body: unknown }[] = []
let pages: unknown[] = []
let sets: unknown[] = []
let session = true
let pagePostStatus = 200

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lcu-lo-'))
  server = https.createServer(
    { key: readFileSync(path.join(__dirname, 'fixtures', 'test-localhost-key.pem')), cert: readFileSync(path.join(__dirname, 'fixtures', 'test-localhost-cert.pem')) },
    (req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const body = text ? JSON.parse(text) : undefined
        calls.push({ method: req.method ?? '', url: req.url ?? '', body })
        const send = (code: number, b: unknown) => {
          res.writeHead(code, { 'content-type': 'application/json' })
          res.end(JSON.stringify(b))
        }
        const u = req.url ?? ''
        if (u === '/lol-champ-select/v1/session' && req.method === 'GET') return send(404, {})
        if (u === '/lol-summoner/v1/current-summoner') return send(200, { puuid: 'p-1234567', gameName: 'Pedro', tagLine: 'BR1', summonerId: 777, accountId: 555 })
        if (u === '/lol-perks/v1/pages' && req.method === 'GET') return send(200, pages)
        if (u === '/lol-perks/v1/pages' && req.method === 'POST') return pagePostStatus === 200 ? send(200, { id: 99 }) : send(pagePostStatus, { message: 'cheio' })
        if (/^\/lol-perks\/v1\/pages\/\d+$/.test(u) && req.method === 'PUT') return send(200, {})
        if (u === '/lol-perks/v1/currentpage' && req.method === 'PUT') return send(204, {})
        if (u === '/lol-champ-select/v1/session/my-selection' && req.method === 'PATCH') return session ? send(204, {}) : send(404, {})
        if (u === '/lol-item-sets/v1/item-sets/777/sets' && req.method === 'GET') return send(200, { accountId: 555, itemSets: sets, timestamp: 1 })
        if (u === '/lol-item-sets/v1/item-sets/777/sets' && req.method === 'PUT') return send(200, {})
        send(404, {})
      })
    }
  )
  wss = new WebSocketServer({ server })
  wss.on('connection', (ws) => {
    sockets.add(ws)
    ws.on('close', () => sockets.delete(ws))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  lockfile = path.join(dir, 'lockfile')
  writeFileSync(lockfile, `LeagueClient:1:${(server.address() as AddressInfo).port}:senha:https`)
})
afterAll(async () => {
  for (const s of sockets) s.terminate()
  wss.close()
  await new Promise((r) => server.close(r))
})
beforeEach(() => {
  calls = []
  pages = []
  sets = []
  session = true
  pagePostStatus = 200
})

async function withClient<T>(fn: (lcu: LcuConnector) => Promise<T>): Promise<T> {
  const lcu = new LcuConnector(() => lockfile)
  lcu.start()
  try {
    const t0 = Date.now()
    while (lcu.getStatus() !== 'connected') {
      if (Date.now() - t0 > 4000) throw new Error('timeout')
      await new Promise((r) => setTimeout(r, 20))
    }
    calls = []
    return await fn(lcu)
  } finally {
    lcu.stop()
  }
}
const io = (lcu: LcuConnector) => ({ get: (p: string) => lcu.get(p), write: (m: 'POST' | 'PUT' | 'PATCH', p: string, b: unknown) => lcu.write(m, p, b) })

describe('importar build para o cliente', () => {
  it('cria a página "Pedro.gg", ativa, e troca os feitiços com Flash no F', async () => {
    const res = await withClient((lcu) => applyLoadout(io(lcu), input({ runes: true, spells: true })))
    expect(res.runes?.ok).toBe(true)
    expect(res.spells?.ok).toBe(true)
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/lol-perks/v1/pages')
    expect(post.body).toMatchObject({ name: 'Pedro.gg Ahri', primaryStyleId: 8100, subStyleId: 8200, selectedPerkIds: build.runes!.perkIds, current: true })
    expect(calls.find((c) => c.url === '/lol-perks/v1/currentpage')?.body).toBe(99)
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ spell1Id: 14, spell2Id: 4 })
  })

  it('reaproveita a página do próprio app e nunca mexe nas páginas do usuário', async () => {
    pages = [
      { id: 1, name: 'Minha página', isEditable: true },
      { id: 2, name: 'Pedro.gg Zed', isEditable: true }
    ]
    await withClient((lcu) => applyLoadout(io(lcu), input({ runes: true })))
    const writes = calls.filter((c) => c.method !== 'GET')
    expect(writes.map((w) => `${w.method} ${w.url}`)).toEqual(['PUT /lol-perks/v1/pages/2', 'PUT /lol-perks/v1/currentpage'])
  })

  it('sem espaço para criar a página, explica o que fazer e não apaga nada', async () => {
    pagePostStatus = 400
    const res = await withClient((lcu) => applyLoadout(io(lcu), input({ runes: true })))
    expect(res.runes?.ok).toBe(false)
    expect(res.runes?.message).toContain('renomeie uma para “Pedro.gg”')
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('feitiços fora da seleção: avisa em vez de falhar calado', async () => {
    session = false
    const res = await withClient((lcu) => applyLoadout(io(lcu), input({ spells: true })))
    expect(res.spells).toEqual({ ok: false, message: 'Os feitiços só podem ser trocados durante a seleção de campeões.' })
  })

  it('itens: troca só o conjunto do próprio app e mantém os do usuário', async () => {
    sets = [
      { uid: 'meu-set', title: 'Meu set', blocks: [] },
      { uid: 'pedrogg-103', title: 'Pedro.gg Ahri antigo', blocks: [] }
    ]
    const res = await withClient((lcu) => applyLoadout(io(lcu), input({ items: true })))
    expect(res.items?.ok).toBe(true)
    const put = calls.find((c) => c.method === 'PUT')!
    const body = put.body as { accountId: number; itemSets: { uid: string; blocks: { type: string; items: { id: string }[] }[] }[] }
    expect(body.accountId).toBe(555)
    expect(body.itemSets.map((s) => s.uid)).toEqual(['meu-set', 'pedrogg-103'])
    const mine = body.itemSets[1]
    expect(mine.blocks.map((b) => b.type)).toEqual(['Inicial', 'Botas', 'Itens principais, na ordem', 'Situacionais'])
    expect(mine.blocks[2].items.map((i) => i.id)).toEqual(['6655', '4645', '3089'])
  })

  it('só faz o que foi marcado e só escreve nos caminhos permitidos', async () => {
    await withClient(async (lcu) => {
      await applyLoadout(io(lcu), input({}))
      expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
      await expect(lcu.write('POST', '/lol-matchmaking/v1/search', {})).rejects.toThrow('Escrita não permitida')
      await expect(lcu.write('PUT', '/lol-perks/v1/pages/../../x', {})).rejects.toThrow('Escrita não permitida')
      expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
    })
  })

  it('o conjunto de itens omite blocos vazios', () => {
    const set = itemSetFor({ ...input({ items: true }), build: { ...build, items: { ...build.items, starting: [], situational: [] } } }) as { blocks: { type: string }[] }
    expect(set.blocks.map((b) => b.type)).toEqual(['Botas', 'Itens principais, na ordem'])
  })
})
