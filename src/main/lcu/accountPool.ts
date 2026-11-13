// src/main/lcu/accountPool.ts
// Lê do cliente do LoL (só leitura) as partidas recentes e a maestria da conta logada e monta a sugestão de Pool.
import { buildPoolSuggestion, COUNTED_QUEUES, type AccountGame, type MasteryEntry, type PoolSuggestResult } from '../../shared/poolImport'
import { toRole } from '../postgame/normalize'
import type { Role } from '../../shared/types'

type Get = (path: string) => Promise<{ status: number; data: unknown }>
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)

const PAGE = 20
const MAX_PAGES = 5
const HISTORY = (beg: number): string => `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${beg}&endIndex=${beg + PAGE}`
const MASTERY = '/lol-champion-mastery/v1/local-player/champion-mastery'

/** O formato muda entre patches: aceita { games: { games: [] } }, { games: [] } e uma lista direta. */
export function gamesOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (!isObj(data)) return []
  const g = data.games
  if (Array.isArray(g)) return g
  if (isObj(g) && Array.isArray(g.games)) return g.games
  return []
}

export function parseGame(raw: unknown): AccountGame | null {
  if (!isObj(raw)) return null
  const queue = num(raw.queueId)
  if (queue !== 0 && !COUNTED_QUEUES.has(queue)) return null
  if (queue === 0) return null // sem fila identificada: melhor não contar
  const parts = Array.isArray(raw.participants) ? raw.participants : []
  const p = parts.find(isObj)
  if (!p) return null
  const championId = num(p.championId)
  if (championId <= 0) return null
  const stats = isObj(p.stats) ? p.stats : {}
  const tl = isObj(p.timeline) ? p.timeline : {}
  const win = typeof stats.win === 'boolean' ? stats.win : String(stats.win ?? '').toLowerCase() === 'win'
  return { championId, role: toRole(tl.role, tl.lane), win }
}

export function parseMastery(data: unknown): MasteryEntry[] {
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.masteries) ? data.masteries : []
  const out: MasteryEntry[] = []
  for (const m of list) {
    if (!isObj(m)) continue
    const championId = num(m.championId)
    if (championId > 0) out.push({ championId, points: num(m.championPoints), level: num(m.championLevel) })
  }
  return out
}

export type AccountRead = { ok: true; account: string | null; games: AccountGame[]; mastery: MasteryEntry[]; pages: number } | { ok: false; message: string }

/** Lê (só leitura) a conta logada: nome, partidas recentes e maestria. */
export async function readAccount(get: Get): Promise<AccountRead> {
  const me = await get('/lol-summoner/v1/current-summoner').catch(() => null)
  if (!me || me.status !== 200 || !isObj(me.data)) return { ok: false, message: 'Abra o League of Legends e entre na sua conta para importar.' }
  const d = me.data
  const account = typeof d.gameName === 'string' && d.gameName ? `${d.gameName}${typeof d.tagLine === 'string' && d.tagLine ? '#' + d.tagLine : ''}` : null

  const games: AccountGame[] = []
  let pages = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await get(HISTORY(page * PAGE)).catch(() => null)
    if (!res || res.status !== 200) break
    const raw = gamesOf(res.data)
    pages++
    for (const g of raw) {
      const parsed = parseGame(g)
      if (parsed) games.push(parsed)
    }
    if (raw.length < PAGE) break
  }
  const mres = await get(MASTERY).catch(() => null)
  const mastery = mres && mres.status === 200 ? parseMastery(mres.data) : []
  if (games.length === 0 && mastery.length === 0) {
    return { ok: false, message: pages === 0 ? 'O cliente não liberou o histórico nem a maestria agora. Espere o cliente terminar de carregar e tente de novo.' : 'Não encontrei partidas normais ou ranqueadas recentes nem maestria nesta conta.' }
  }
  return { ok: true, account, games, mastery, pages }
}

export async function suggestPoolFromAccount(get: Get, roleHint: (championId: number) => Role | null): Promise<PoolSuggestResult> {
  const read = await readAccount(get)
  if (!read.ok) return read
  return { ok: true, account: read.account, suggestion: buildPoolSuggestion(read.games, read.mastery, roleHint) }
}
