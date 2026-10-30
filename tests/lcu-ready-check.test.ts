// @vitest-environment node
// Cliente do LoL falso (HTTPS autoassinado + WebSocket) para testar o aceite de ponta a ponta.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import { LcuConnector } from '../src/main/lcu/connector'
import { AutoAccept } from '../src/main/autoAccept'
import type { ReadyCheck } from '../src/shared/types'

const PASSWORD = 'segredo123'
let dir: string
let server: https.Server
let wss: WebSocketServer
let lockfile: string
const requests: { method: string; url: string; auth: string }[] = []
const sockets = new Set<WebSocket>()
const subscriptions: string[] = []
let readyState: ReadyCheck | null = null

const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condição')
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'lcu-'))
  server = https.createServer(
    // certificado só para teste (fixtures/), assim o teste não depende do openssl, que não existe no Windows
    { key: readFileSync(path.join(__dirname, 'fixtures', 'test-localhost-key.pem')), cert: readFileSync(path.join(__dirname, 'fixtures', 'test-localhost-cert.pem')) },
    (req, res) => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization ?? '' })
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.url === '/lol-champ-select/v1/session') return send(404, {})
      if (req.url === '/lol-matchmaking/v1/ready-check' && req.method === 'GET') {
        return readyState ? send(200, readyState) : send(404, {})
      }
      if (req.url === '/lol-matchmaking/v1/ready-check/accept' && req.method === 'POST') return send(204, {})
      send(404, {})
    }
  )
  wss = new WebSocketServer({ server })
  wss.on('connection', (ws) => {
    sockets.add(ws)
    ws.on('message', (m) => subscriptions.push(String(m)))
    ws.on('close', () => sockets.delete(ws))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  lockfile = path.join(dir, 'lockfile')
  writeFileSync(lockfile, `LeagueClient:1234:${port}:${PASSWORD}:https`)
})

afterAll(async () => {
  for (const s of sockets) s.terminate()
  wss.close()
  await new Promise((r) => server.close(r))
})

describe('LcuConnector + aceite automático (cliente falso)', () => {
  it('assina o ready check, aceita uma vez e só usa o caminho de aceitar', async () => {
    const lcu = new LcuConnector(() => lockfile)
    let accepted = 0
    const aa = new AutoAccept({
      isEnabled: () => true,
      getDelaySec: () => 0,
      accept: () => lcu.acceptReadyCheck(),
      onAccepted: () => accepted++
    })
    lcu.on('ready-check', (c) => aa.update(c))
    lcu.start()
    try {
      await until(() => lcu.getStatus() === 'connected' && sockets.size === 1)
      await until(() => subscriptions.some((s) => s.includes('ready-check')))

      const push = (data: unknown, eventType = 'Update') => {
        for (const s of sockets) {
          s.send(JSON.stringify([8, 'OnJsonApiEvent_lol-matchmaking_v1_ready-check', { eventType, data, uri: '/x' }]))
        }
      }
      push({ state: 'InProgress', playerResponse: 'None', timer: 1 })
      push({ state: 'InProgress', playerResponse: 'None', timer: 2 })
      await until(() => accepted === 1)
      push({ state: 'InProgress', playerResponse: 'Accepted' })
      push(null, 'Delete')
      await new Promise((r) => setTimeout(r, 150))
      expect(accepted).toBe(1)

      const writes = requests.filter((r) => r.method !== 'GET')
      expect(writes).toEqual([
        { method: 'POST', url: '/lol-matchmaking/v1/ready-check/accept', auth: `Basic ${Buffer.from(`riot:${PASSWORD}`).toString('base64')}` }
      ])
    } finally {
      aa.stop()
      lcu.stop()
    }
  })

  it('se o app abrir com a janela de partida já aberta, lê o estado e aceita', async () => {
    readyState = { state: 'InProgress', playerResponse: 'None' }
    const lcu = new LcuConnector(() => lockfile)
    let accepted = 0
    const aa = new AutoAccept({
      isEnabled: () => true,
      getDelaySec: () => 0,
      accept: () => lcu.acceptReadyCheck(),
      onAccepted: () => accepted++
    })
    lcu.on('ready-check', (c) => aa.update(c))
    lcu.start()
    try {
      await until(() => accepted === 1)
    } finally {
      aa.stop()
      lcu.stop()
      readyState = null
    }
  })
})
