// @vitest-environment node
// Cliente do LoL falso: reconexão no meio da partida (sessão velha, socket meio aberto).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { LcuConnector } from '../src/main/lcu/connector'

let dir: string
let server: https.Server
let wss: WebSocketServer
let lockfile: string
const sockets = new Set<WebSocket>()
let phase = 'InProgress'
let sessionStatus = 200
let gameflowStatus = 200

const staleSession = {
  localPlayerCellId: 0,
  timer: { phase: 'GAME_STARTING' },
  myTeam: [{ cellId: 0, championId: 103, assignedPosition: 'middle' }],
  theirTeam: [{ cellId: 5, championId: 238, assignedPosition: 'middle' }],
  actions: []
}

const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condição')
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'lcu-rc-'))
  server = https.createServer(
    { key: readFileSync(path.join(__dirname, 'fixtures', 'test-localhost-key.pem')), cert: readFileSync(path.join(__dirname, 'fixtures', 'test-localhost-cert.pem')) },
    (req, res) => {
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.url === '/lol-champ-select/v1/session') return sessionStatus === 200 ? send(200, staleSession) : send(404, {})
      if (req.url === '/lol-gameflow/v1/gameflow-phase') return gameflowStatus === 200 ? send(200, phase) : send(500, {})
      send(404, {})
    }
  )
  wss = new WebSocketServer({ server })
  wss.on('connection', (ws) => {
    sockets.add(ws)
    ws.on('close', () => sockets.delete(ws))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  lockfile = path.join(dir, 'lockfile')
  writeFileSync(lockfile, `LeagueClient:1234:${port}:segredo:https`)
})

afterAll(async () => {
  for (const s of sockets) s.terminate()
  wss.close()
  await new Promise((r) => server.close(r))
})

describe('reconexão no meio da partida', () => {
  it('a seleção velha que o cliente ainda devolve não vira draft quando a fase é InProgress', async () => {
    phase = 'InProgress'
    sessionStatus = 200
    const lcu = new LcuConnector(() => lockfile)
    const drafts: unknown[] = []
    const phases: string[] = []
    lcu.on('draft', (d) => drafts.push(d))
    lcu.on('gameflow', (p) => phases.push(p))
    lcu.start()
    try {
      await until(() => lcu.getStatus() === 'connected')
      expect(phases).toContain('InProgress')
      expect(drafts).toHaveLength(0)
      expect(lcu.getLastDraft()).toBeNull()
    } finally {
      lcu.stop()
    }
  })

  it('sessão velha que chega pelo socket durante a partida também é ignorada', async () => {
    phase = 'InProgress'
    sessionStatus = 404
    const lcu = new LcuConnector(() => lockfile)
    const drafts: unknown[] = []
    lcu.on('draft', (d) => drafts.push(d))
    lcu.start()
    try {
      await until(() => lcu.getStatus() === 'connected' && sockets.size > 0)
      for (const s of sockets) s.send(JSON.stringify([8, 'OnJsonApiEvent_lol-champ-select_v1_session', { eventType: 'Update', data: staleSession, uri: '/x' }]))
      await new Promise((r) => setTimeout(r, 150))
      expect(drafts).toHaveLength(0)
    } finally {
      lcu.stop()
    }
  })

  it('na fase ChampSelect a seleção aberta aparece normalmente; ao virar InProgress o draft é descartado', async () => {
    phase = 'ChampSelect'
    sessionStatus = 200
    const lcu = new LcuConnector(() => lockfile)
    const drafts: unknown[] = []
    let ended = 0
    lcu.on('draft', (d) => drafts.push(d))
    lcu.on('draft-ended', () => ended++)
    lcu.start()
    try {
      await until(() => drafts.length === 1)
      for (const s of sockets) s.send(JSON.stringify([8, 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase', { eventType: 'Update', data: 'InProgress', uri: '/x' }]))
      await until(() => ended === 1)
      expect(lcu.getLastDraft()).toBeNull()
    } finally {
      lcu.stop()
    }
  })
})
