// src/main/lcu/connector.ts
import { EventEmitter } from 'node:events'
import https from 'node:https'
import WebSocket from 'ws'
import { findLockfilePath, readLockfile, type LockfileData } from './lockfile'
import { normalizeSession } from './champSelect'
import type { DraftState, LcuStatus, ReadyCheck } from '../../shared/types'

const HOST = '127.0.0.1'
const SESSION_PATH = '/lol-champ-select/v1/session'
const SESSION_EVENT = 'OnJsonApiEvent_lol-champ-select_v1_session'
const READY_PATH = '/lol-matchmaking/v1/ready-check'
const READY_EVENT = 'OnJsonApiEvent_lol-matchmaking_v1_ready-check'
/** Única escrita que o app faz no cliente, e só quando o usuário liga o "aceitar automático". */
const ACCEPT_PATH = '/lol-matchmaking/v1/ready-check/accept'
const GAMEFLOW_PATH = '/lol-gameflow/v1/gameflow-phase'
const GAMEFLOW_EVENT = 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase'
const RETRY_MS = 3000
const REQUEST_TIMEOUT_MS = 5000

// O cliente usa certificado autoassinado da Riot. Aceitamos isso SOMENTE neste
// agente, que só fala com 127.0.0.1. Nunca usar NODE_TLS_REJECT_UNAUTHORIZED=0
// (desligaria a validação do processo inteiro, incluindo chamadas à internet).
const localAgent = new https.Agent({ rejectUnauthorized: false })

export interface LcuEvents {
  status: (status: LcuStatus) => void
  draft: (draft: DraftState) => void
  'draft-ended': () => void
  'ready-check': (check: ReadyCheck | null) => void
  /** fase do cliente: None, Lobby, Matchmaking, ReadyCheck, ChampSelect, InProgress, WaitingForStats, EndOfGame... */
  gameflow: (phase: string) => void
}

export interface LcuConnector {
  on<E extends keyof LcuEvents>(event: E, listener: LcuEvents[E]): this
  emit<E extends keyof LcuEvents>(event: E, ...args: Parameters<LcuEvents[E]>): boolean
}

export class LcuConnector extends EventEmitter {
  private ws: WebSocket | null = null
  private creds: LockfileData | null = null
  private timer: NodeJS.Timeout | null = null
  private running = false
  private status: LcuStatus = 'searching'
  private lastDraft: DraftState | null = null
  private lastKey = ''

  constructor(private readonly getLockfileOverride: () => string | null = () => null) {
    super()
  }

  // ---------- API pública ----------

  start(): void {
    if (this.running) return
    this.running = true
    void this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.closeSocket()
    this.creds = null
    this.clearDraft()
    this.setStatus('disconnected')
  }

  getStatus(): LcuStatus {
    return this.status
  }

  getLastDraft(): DraftState | null {
    return this.lastDraft
  }

  /** Leitura genérica (GET). O app só lê do cliente, com a única exceção de `acceptReadyCheck`. */
  get(path: string): Promise<{ status: number; data: unknown }> {
    return this.request('GET', path)
  }

  /**
   * Aceita a partida encontrada. É a ÚNICA escrita permitida e o caminho é fixo: não existe
   * um "post" genérico, então nada além do botão Aceitar pode ser enviado ao cliente.
   */
  async acceptReadyCheck(): Promise<boolean> {
    const res = await this.request('POST', ACCEPT_PATH)
    return res.status >= 200 && res.status < 300
  }

  private request(method: 'GET' | 'POST', path: string): Promise<{ status: number; data: unknown }> {
    const c = this.creds
    if (!c) return Promise.reject(new Error('LCU não conectada'))
    if (!path.startsWith('/')) return Promise.reject(new Error('Caminho inválido'))

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: HOST,
          port: c.port,
          path,
          method,
          agent: localAgent,
          timeout: REQUEST_TIMEOUT_MS,
          headers: { Authorization: authHeader(c), Accept: 'application/json' }
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (d: Buffer) => chunks.push(d))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            let data: unknown = null
            try {
              data = text ? JSON.parse(text) : null
            } catch {
              /* corpo não-JSON: devolve null */
            }
            resolve({ status: res.statusCode ?? 0, data })
          })
        }
      )
      req.on('timeout', () => req.destroy(new Error('Timeout na LCU')))
      req.on('error', reject)
      req.end()
    })
  }

  // ---------- Ciclo de conexão ----------

  private async tick(): Promise<void> {
    if (!this.running) return
    try {
      const file = await findLockfilePath(this.getLockfileOverride())
      if (!file) {
        this.setStatus('searching')
        return this.schedule()
      }
      this.creds = await readLockfile(file)
      await this.openSocket(this.creds)
      await this.fetchInitialSession()
      this.setStatus('connected')
    } catch {
      // Lockfile obsoleto, cliente ainda iniciando, porta recusando etc.
      this.closeSocket()
      this.creds = null
      this.schedule()
    }
  }

  private schedule(): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), RETRY_MS)
  }

  private openSocket(c: LockfileData): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://${HOST}:${c.port}/`, {
        headers: { Authorization: authHeader(c) },
        rejectUnauthorized: false // escopo: apenas este socket local
      })
      this.ws = ws

      ws.once('open', () => {
        // Protocolo WAMP da LCU: [5, evento] = SUBSCRIBE
        ws.send(JSON.stringify([5, SESSION_EVENT]))
        ws.send(JSON.stringify([5, READY_EVENT]))
        ws.send(JSON.stringify([5, GAMEFLOW_EVENT]))
        resolve()
      })
      ws.on('message', (data) => {
        if (ws === this.ws) this.onMessage(data.toString())
      })
      ws.on('error', (err) => reject(err)) // sem listener, um erro derrubaria o Main
      ws.on('close', () => {
        if (ws !== this.ws) return // socket antigo, já descartado
        this.ws = null
        this.onDisconnect()
      })
    })
  }

  private closeSocket(): void {
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.removeAllListeners('message')
    try {
      ws.terminate()
    } catch {
      /* já fechado */
    }
  }

  private onDisconnect(): void {
    this.creds = null
    this.clearDraft()
    this.setStatus('disconnected')
    this.schedule()
  }

  // ---------- Dados ----------

  private async fetchInitialSession(): Promise<void> {
    // Se o app abrir no meio de uma Champ Select, pegamos o estado atual.
    const res = await this.get(SESSION_PATH)
    if (res.status === 200) this.publish(res.data)
    else if (res.status !== 404) throw new Error(`LCU respondeu ${res.status}`) // 404 = fora da seleção

    // Se o app abrir com a janela "partida encontrada" já aberta. Falha aqui nunca derruba a conexão.
    try {
      const gf = await this.get(GAMEFLOW_PATH)
      if (gf.status === 200 && typeof gf.data === 'string') this.emit('gameflow', gf.data)
    } catch {
      /* só informativo */
    }
    try {
      const rc = await this.get(READY_PATH)
      if (rc.status === 200) this.publishReadyCheck(rc.data)
    } catch {
      /* sem fila: nada a fazer */
    }
  }

  private onMessage(raw: string): void {
    if (!raw) return
    let msg: unknown
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    // Formato: [8, "<evento>", { eventType: "Create|Update|Delete", data, uri }]
    if (!Array.isArray(msg) || msg[0] !== 8) return
    const payload = msg[2] as { eventType?: string; data?: unknown } | undefined
    if (msg[1] === GAMEFLOW_EVENT) {
      if (typeof payload?.data === 'string') this.emit('gameflow', payload.data)
      return
    }
    if (msg[1] === READY_EVENT) {
      if (payload?.eventType === 'Delete') this.emit('ready-check', null)
      else this.publishReadyCheck(payload?.data)
      return
    }
    if (msg[1] !== SESSION_EVENT) return
    if (payload?.eventType === 'Delete') return this.clearDraft()
    this.publish(payload?.data)
  }

  private publishReadyCheck(data: unknown): void {
    if (typeof data !== 'object' || data === null) return
    const d = data as Record<string, unknown>
    if (typeof d.state !== 'string') return
    this.emit('ready-check', { state: d.state, playerResponse: typeof d.playerResponse === 'string' ? d.playerResponse : 'None' })
  }

  private publish(data: unknown): void {
    const draft = normalizeSession(data)
    if (!draft) return
    const key = JSON.stringify(draft)
    if (key === this.lastKey) return // evita re-render por eventos redundantes
    this.lastKey = key
    this.lastDraft = draft
    this.emit('draft', draft)
  }

  private clearDraft(): void {
    const had = this.lastDraft !== null
    this.lastDraft = null
    this.lastKey = ''
    if (had) this.emit('draft-ended')
  }

  private setStatus(s: LcuStatus): void {
    if (s === this.status) return
    this.status = s
    this.emit('status', s)
  }
}

function authHeader(c: LockfileData): string {
  return 'Basic ' + Buffer.from(`riot:${c.password}`).toString('base64')
}
