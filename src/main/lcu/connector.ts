// src/main/lcu/connector.ts
import { EventEmitter } from 'node:events'
import https from 'node:https'
import WebSocket from 'ws'
import { findLockfilePath, readLockfile, type LockfileData } from './lockfile'
import { normalizeSession } from './champSelect'
import type { AccountStats, DraftState, LcuIdentity, LcuStatus, ReadyCheck } from '../../shared/types'

const HOST = '127.0.0.1'
const SESSION_PATH = '/lol-champ-select/v1/session'
const SESSION_EVENT = 'OnJsonApiEvent_lol-champ-select_v1_session'
const READY_PATH = '/lol-matchmaking/v1/ready-check'
const READY_EVENT = 'OnJsonApiEvent_lol-matchmaking_v1_ready-check'
/** Única escrita que o app faz no cliente, e só quando o usuário liga o "aceitar automático". */
const ACCEPT_PATH = '/lol-matchmaking/v1/ready-check/accept'
const GAMEFLOW_PATH = '/lol-gameflow/v1/gameflow-phase'
const GAMEFLOW_EVENT = 'OnJsonApiEvent_lol-gameflow_v1_gameflow-phase'
const ME_PATH = '/lol-summoner/v1/current-summoner'
const SUMMONER_BY_PUUID = '/lol-summoner/v1/summoners-by-puuid-cached/'
/** Caminhos que o botão "Importar para o cliente" pode escrever (nada além disto, nem o aceite, passa por aqui). */
const LOADOUT_WRITE_PATHS: RegExp[] = [
  /^\/lol-perks\/v1\/pages$/,
  /^\/lol-perks\/v1\/pages\/\d{1,12}$/,
  /^\/lol-perks\/v1\/currentpage$/,
  /^\/lol-champ-select\/v1\/session\/my-selection$/,
  /^\/lol-item-sets\/v1\/item-sets\/\d{1,20}\/sets$/
]
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
  /** conta logada no cliente (chega ao conectar) */
  identity: (me: LcuIdentity) => void
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
  private identity: LcuIdentity | null = null
  /** puuid → "Nome#TAG" (só aliados da seleção atual; vale até desconectar) */
  private names = new Map<string, string>()
  private resolving = new Set<string>()

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

  getIdentity(): LcuIdentity | null {
    return this.identity
  }

  /** Lê a conta logada. Falha aqui nunca derruba a conexão. */
  async refreshIdentity(): Promise<LcuIdentity | null> {
    try {
      const res = await this.get(ME_PATH)
      if (res.status !== 200 || typeof res.data !== 'object' || res.data === null) return this.identity
      const d = res.data as Record<string, unknown>
      const puuid = typeof d.puuid === 'string' ? d.puuid : ''
      const gameName = typeof d.gameName === 'string' && d.gameName ? d.gameName : typeof d.displayName === 'string' ? d.displayName : ''
      const tagLine = typeof d.tagLine === 'string' ? d.tagLine : ''
      if (!puuid || !gameName) return this.identity
      const next = { puuid, gameName, tagLine }
      if (!this.identity || this.identity.puuid !== puuid || this.identity.gameName !== gameName || this.identity.tagLine !== tagLine) {
        this.identity = next
        this.names.set(puuid, tagLine ? `${gameName}#${tagLine}` : gameName)
        this.logger?.('identity', 'conta detectada')
        this.emit('identity', next)
      }
      return this.identity
    } catch {
      return this.identity
    }
  }

  /** Nível (current-summoner) e elo Solo/Duo (current-ranked-stats). Tudo opcional: endpoints não oficiais. */
  async getAccountStats(): Promise<AccountStats | null> {
    if (!this.identity) return null
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const out: AccountStats = { level: null, tier: null, division: null, lp: null, wins: null, losses: null }
    try {
      const me = await this.get(ME_PATH)
      if (me.status === 200 && me.data && typeof me.data === 'object') out.level = num((me.data as Record<string, unknown>).summonerLevel)
    } catch {
      /* segue sem nível */
    }
    try {
      const r = await this.get('/lol-ranked/v1/current-ranked-stats')
      if (r.status === 200 && r.data && typeof r.data === 'object') {
        const d = r.data as Record<string, unknown>
        const queues = d.queueMap && typeof d.queueMap === 'object' ? (d.queueMap as Record<string, unknown>) : {}
        const solo = (queues.RANKED_SOLO_5x5 ?? (Array.isArray(d.queues) ? d.queues.find((q) => (q as Record<string, unknown>)?.queueType === 'RANKED_SOLO_5x5') : null)) as Record<string, unknown> | null | undefined
        if (solo && typeof solo === 'object') {
          const tier = typeof solo.tier === 'string' ? solo.tier.toUpperCase() : ''
          if (tier && tier !== 'NA' && tier !== 'NONE') {
            out.tier = tier
            out.division = typeof solo.division === 'string' && solo.division !== 'NA' ? solo.division : null
            out.lp = num(solo.leaguePoints)
          }
          out.wins = num(solo.wins)
          out.losses = num(solo.losses)
        }
      }
    } catch {
      /* segue sem elo */
    }
    return out
  }

  /** Leitura genérica (GET). O app só lê do cliente, com a única exceção de `acceptReadyCheck`. */
  get(path: string): Promise<{ status: number; data: unknown }> {
    return this.request('GET', path)
  }

  /**
   * Aceita a partida encontrada. É a ÚNICA escrita permitida e o caminho é fixo: não existe
   * um "post" genérico, então nada além do botão Aceitar pode ser enviado ao cliente.
   */
  async acceptReadyCheck(): Promise<{ ok: boolean; status: number }> {
    try {
      const res = await this.request('POST', ACCEPT_PATH)
      const ok = res.status >= 200 && res.status < 300
      this.logger?.('accept', `POST ready-check/accept -> HTTP ${res.status}${ok ? '' : ' ' + JSON.stringify(res.data).slice(0, 160)}`)
      return { ok, status: res.status }
    } catch (err) {
      this.logger?.('accept', `POST ready-check/accept falhou: ${err instanceof Error ? err.message : 'erro'}`)
      return { ok: false, status: 0 }
    }
  }

  /**
   * Escrita restrita ao "carregar build" (runas, feitiços e itens da partida). Só roda quando o usuário
   * clica em Importar, e só nestes caminhos: qualquer outro é recusado aqui, antes de sair do app.
   */
  write(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown): Promise<{ status: number; data: unknown }> {
    if (!LOADOUT_WRITE_PATHS.some((re) => re.test(path))) return Promise.reject(new Error('Escrita não permitida'))
    return this.request(method, path, body).then((res) => {
      this.logger?.('importar', `${method} ${path.replace(/\/\d{4,}\//, '/…/')} -> HTTP ${res.status}`)
      return res
    })
  }

  /** Lê o estado atual da janela "partida encontrada" (usado como plano B quando o evento não chega). */
  async readReadyCheck(): Promise<ReadyCheck | null> {
    try {
      const res = await this.get(READY_PATH)
      if (res.status !== 200 || typeof res.data !== 'object' || res.data === null) return null
      const d = res.data as Record<string, unknown>
      if (typeof d.state !== 'string') return null
      return { state: d.state, playerResponse: typeof d.playerResponse === 'string' ? d.playerResponse : 'None' }
    } catch {
      return null
    }
  }

  private logger: ((tag: string, message: string) => void) | null = null
  setLogger(fn: (tag: string, message: string) => void): void {
    this.logger = fn
  }

  private request(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    const c = this.creds
    if (!c) return Promise.reject(new Error('LCU não conectada'))
    if (!path.startsWith('/')) return Promise.reject(new Error('Caminho inválido'))

    const payload = body === undefined ? undefined : JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: HOST,
          port: c.port,
          path,
          method,
          agent: localAgent,
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            Authorization: authHeader(c),
            Accept: 'application/json',
            ...(payload !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
          }
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
      req.end(payload)
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
        this.logger?.('ws', 'conectado e inscrito em champ-select, ready-check e gameflow')
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
    this.names.clear()
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

    await this.refreshIdentity()

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
      if (typeof payload?.data === 'string') {
        this.logger?.('gameflow', payload.data)
        this.emit('gameflow', payload.data)
      }
      return
    }
    if (msg[1] === READY_EVENT) {
      const d = payload?.data as Record<string, unknown> | null | undefined
      if (payload?.eventType === 'Delete') this.logger?.('ready-check', 'janela fechou')
      else this.logger?.('ready-check', `state=${String(d?.state)} playerResponse=${String(d?.playerResponse)} timer=${String(d?.timer)}`)
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

  /** Completa "Nome#TAG" dos aliados que o cliente só entrega como puuid (usa o que já foi resolvido). */
  private withNames(d: DraftState): DraftState {
    return {
      ...d,
      allies: d.allies.map((p) => (p.name || !p.puuid || !this.names.has(p.puuid) ? p : { ...p, name: this.names.get(p.puuid) }))
    }
  }

  private resolveNames(d: DraftState): void {
    for (const p of d.allies) {
      const puuid = p.puuid
      if (!puuid || p.name || this.names.has(puuid) || this.resolving.has(puuid) || !/^[\w-]{8,100}$/.test(puuid)) continue
      this.resolving.add(puuid)
      void this.get(SUMMONER_BY_PUUID + puuid)
        .then((res) => {
          const r = res.data as Record<string, unknown> | null
          if (res.status === 200 && r && typeof r.gameName === 'string' && r.gameName) {
            this.names.set(puuid, typeof r.tagLine === 'string' && r.tagLine ? `${r.gameName}#${r.tagLine}` : r.gameName)
            if (this.lastDraft) this.publishDraft(this.lastDraft)
          }
        })
        .catch(() => undefined)
        .finally(() => this.resolving.delete(puuid))
    }
  }

  private publish(data: unknown): void {
    const raw = normalizeSession(data)
    if (!raw) return
    this.publishDraft(raw)
    if (this.lastDraft) this.resolveNames(this.lastDraft)
  }

  private publishDraft(raw: DraftState): void {
    const draft = this.withNames(raw)
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
