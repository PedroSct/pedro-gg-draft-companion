// @vitest-environment node
// Cliente falso: conta logada e nomes dos aliados da seleção.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { LcuConnector } from '../src/main/lcu/connector'
import type { DraftState } from '../src/shared/types'

let server: https.Server
let wss: WebSocketServer
let lockfile: string
const sockets = new Set<WebSocket>()
const requests: { method: string; url: string }[] = []

const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condição')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const session = {
  localPlayerCellId: 0,
  myTeam: [
    { cellId: 0, puuid: 'puuid-pedro-0001', assignedPosition: 'utility' },
    { cellId: 1, puuid: 'puuid-aline-0002', assignedPosition: 'middle', gameName: 'Aline', tagLine: 'BR1' },
    { cellId: 2, puuid: 'puuid-caio-00003', assignedPosition: 'top' }
  ],
  theirTeam: [],
  actions: [],
  timer: { phase: 'BAN_PICK' }
}

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lcu-id-'))
  server = https.createServer(
    { key: readFileSync(path.join(__dirname, 'fixtures', 'test-localhost-key.pem')), cert: readFileSync(path.join(__dirname, 'fixtures', 'test-localhost-cert.pem')) },
    (req, res) => {
      requests.push({ method: req.method ?? '', url: req.url ?? '' })
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.url === '/lol-summoner/v1/current-summoner') return send(200, { puuid: 'puuid-pedro-0001', gameName: 'Pedro', tagLine: 'BR1', summonerId: 7, summonerLevel: 312 })
      if (req.url === '/lol-ranked/v1/current-ranked-stats') return send(200, { queueMap: { RANKED_SOLO_5x5: { tier: 'GOLD', division: 'II', leaguePoints: 45, wins: 52, losses: 48 }, RANKED_FLEX_SR: { tier: '', division: 'NA' } } })
      if (req.url === '/lol-summoner/v1/summoners-by-puuid-cached/puuid-pedro-0001') return send(200, { gameName: 'Pedro', tagLine: 'BR1' })
      if (req.url === '/lol-summoner/v1/summoners-by-puuid-cached/puuid-caio-00003') return send(200, { gameName: 'Caio', tagLine: 'LOL' })
      if (req.url === '/lol-champ-select/v1/session') return send(200, session)
      send(404, {})
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

describe('LcuConnector: conta e nomes', () => {
  it('lê a conta logada e completa o nome dos aliados que só vêm com puuid', async () => {
    const lcu = new LcuConnector(() => lockfile)
    const drafts: DraftState[] = []
    lcu.on('draft', (d) => drafts.push(d))
    lcu.start()
    try {
      await until(() => lcu.getStatus() === 'connected')
      expect(lcu.getIdentity()).toEqual({ puuid: 'puuid-pedro-0001', gameName: 'Pedro', tagLine: 'BR1' })
      // O nome de quem o cliente já informou não é consultado de novo; o do Caio é resolvido por puuid.
      await until(() => lcu.getLastDraft()?.allies.find((a) => a.cellId === 2)?.name === 'Caio#LOL')
      const names = lcu.getLastDraft()!.allies.map((a) => a.name)
      expect(names).toEqual(['Pedro#BR1', 'Aline#BR1', 'Caio#LOL'])
      expect(requests.some((r) => r.url.endsWith('puuid-aline-0002'))).toBe(false)
      expect(requests.every((r) => r.method === 'GET')).toBe(true)
      expect(drafts.length).toBeGreaterThanOrEqual(1)
    } finally {
      lcu.stop()
    }
  })

  it('lê nível e elo Solo/Duo da conta', async () => {
    const lcu = new LcuConnector(() => lockfile)
    lcu.start()
    try {
      await until(() => lcu.getStatus() === 'connected')
      await until(() => lcu.getIdentity() !== null)
      expect(await lcu.getAccountStats()).toEqual({ level: 312, tier: 'GOLD', division: 'II', lp: 45, wins: 52, losses: 48 })
    } finally {
      lcu.stop()
    }
  })
})
