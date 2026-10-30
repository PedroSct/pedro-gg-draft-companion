// src/main/postgame/collector.ts
// Quando a partida termina, busca no cliente do LoL o placar final, os detalhes e a timeline,
// monta o relatório, analisa e guarda. Não usa chave de API da Riot: tudo vem do cliente local.
import { analyzeMatch, type PgFetchResult, type PgSummary } from '../../shared/postgame'
import { findGameIds, normalizeMatch, type Identity } from './normalize'
import type { PostGameStore } from './store'

export interface CollectorDeps {
  get(path: string): Promise<{ status: number; data: unknown }>
  store: PostGameStore
  champKeyOf(id: number): string | null
  onReady(summary: PgSummary): void
  sleep?(ms: number): Promise<void>
  /** quantas tentativas e quanto esperar entre elas (o cliente demora a publicar o histórico) */
  attempts?: number
  waitMs?: number
}

const END_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame'])

const EOG = '/lol-end-of-game/v1/eog-stats-block'
const GAME = (id: number): string => `/lol-match-history/v1/games/${id}`
const TIMELINE = (id: number): string => `/lol-match-history/v1/game-timelines/${id}`
const SUMMONER = '/lol-summoner/v1/current-summoner'
const LIST_PATHS = [
  '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=5',
  '/lol-match-history/v2/matchlist',
  '/lol-match-history/v1/matchlist'
]

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export class PostGameCollector {
  private busy = false
  private readonly sleep: (ms: number) => Promise<void>
  private readonly attempts: number
  private readonly waitMs: number

  constructor(private readonly d: CollectorDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.attempts = d.attempts ?? 6
    this.waitMs = d.waitMs ?? 4000
  }

  /** Chamado a cada mudança de fase do cliente. */
  onPhase(phase: string): void {
    if (!END_PHASES.has(phase) || this.busy) return
    void this.collect().catch(() => undefined)
  }

  /** Busca a partida que acabou de terminar (placar final do cliente). */
  async collect(): Promise<PgFetchResult> {
    return this.run(async () => {
      let gameId = 0
      for (let i = 0; i < this.attempts && gameId === 0; i++) {
        const eog = await this.safeGet(EOG)
        if (eog && isObj(eog.data) && typeof eog.data.gameId === 'number') gameId = eog.data.gameId
        else if (i < this.attempts - 1) await this.sleep(this.waitMs / 2)
      }
      if (gameId === 0) return { ok: false, message: 'O cliente ainda não liberou o resultado da partida.' }
      return this.build(gameId, false)
    })
  }

  /** Botão "Analisar última partida": pega a mais recente do histórico do cliente. */
  async collectLatest(): Promise<PgFetchResult> {
    return this.run(async () => {
      for (const p of LIST_PATHS) {
        const res = await this.safeGet(p)
        if (!res || res.status !== 200) continue
        const ids = findGameIds(res.data, 1)
        if (ids.length > 0) return this.build(ids[0], true)
      }
      return { ok: false, message: 'Não encontrei partidas no histórico do cliente. Abra o League of Legends e tente de novo.' }
    })
  }

  private async run(fn: () => Promise<PgFetchResult>): Promise<PgFetchResult> {
    if (this.busy) return { ok: false, message: 'Já estou buscando uma partida. Espere um instante.' }
    this.busy = true
    try {
      return await fn()
    } catch {
      return { ok: false, message: 'Não consegui ler os dados da partida. O cliente pode ter fechado.' }
    } finally {
      this.busy = false
    }
  }

  private async safeGet(path: string): Promise<{ status: number; data: unknown } | null> {
    try {
      return await this.d.get(path)
    } catch {
      return null
    }
  }

  private async build(gameId: number, force: boolean): Promise<PgFetchResult> {
    const existing = await this.d.store.get(gameId)
    // Já temos a partida completa (com timeline): nada a fazer, a não ser que peçam de novo.
    if (existing?.report.hasTimeline && !force) return { ok: true, gameId, message: 'Partida já analisada.' }

    const [eogRes, sum] = await Promise.all([this.safeGet(EOG), this.safeGet(SUMMONER)])
    const eog = eogRes && eogRes.status === 200 && isObj(eogRes.data) && eogRes.data.gameId === gameId ? eogRes.data : null

    let game: unknown = null
    let timeline: unknown = null
    for (let i = 0; i < this.attempts; i++) {
      if (!game) {
        const g = await this.safeGet(GAME(gameId))
        if (g && g.status === 200 && isObj(g.data) && Array.isArray(g.data.participants) && g.data.participants.length > 0) game = g.data
      }
      if (!timeline) {
        const t = await this.safeGet(TIMELINE(gameId))
        if (t && t.status === 200 && isObj(t.data)) timeline = t.data
      }
      if (game && timeline) break
      if (i < this.attempts - 1) await this.sleep(this.waitMs)
    }

    const me: Identity = {}
    if (sum && sum.status === 200 && isObj(sum.data)) {
      const s = sum.data
      if (typeof s.puuid === 'string') me.puuid = s.puuid
      if (typeof s.summonerId === 'number' || typeof s.summonerId === 'string') me.summonerId = s.summonerId
      if (typeof s.accountId === 'number' || typeof s.accountId === 'string') me.accountId = s.accountId
      const name = typeof s.gameName === 'string' && s.gameName ? s.gameName : typeof s.displayName === 'string' ? s.displayName : ''
      if (name) me.name = name
    }

    const raw = { eog, game, timeline, me }
    void this.d.store.saveRaw(gameId, raw)
    const report = normalizeMatch(raw, { champKeyOf: this.d.champKeyOf })
    if (!report) return { ok: false, gameId, message: 'O cliente não entregou os dados desta partida.' }
    if (report.gameId === 0) report.gameId = gameId
    const analysis = analyzeMatch(report)
    if (!analysis) return { ok: false, gameId, message: 'Não consegui identificar você nesta partida.' }

    const summary = await this.d.store.put(report, analysis)
    this.d.onReady(summary)
    return {
      ok: true,
      gameId,
      message: report.hasTimeline ? 'Partida analisada.' : 'Partida analisada só com o placar final (sem a linha do tempo).'
    }
  }
}
