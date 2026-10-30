// src/main/postgame/normalize.ts
// Converte o que o cliente do LoL devolve (placar final, detalhes da partida e timeline) em MatchReport.
//
// Os endpoints do cliente (LCU) não são oficiais e o formato muda de patch em patch, então este
// leitor é de propósito tolerante: aceita os nomes de campo do formato antigo e do Match-v5, e se uma
// parte faltar (ex.: sem timeline) devolve o que deu, em vez de falhar a partida inteira.
import { CHAMPION_TRAITS } from '../../shared/championMeta'
import type {
  MatchReport,
  PgEvent,
  PgEventKind,
  PgFrame,
  PgFramePlayer,
  PgParticipant
} from '../../shared/postgame'
import type { Role } from '../../shared/types'

export interface Identity {
  puuid?: string
  summonerId?: number | string
  accountId?: number | string
  name?: string
}

export interface RawMatch {
  eog?: unknown
  game?: unknown
  timeline?: unknown
  me?: Identity
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : d
}
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
/** Primeiro campo presente entre vários nomes possíveis. */
const pick = (o: Obj | undefined, keys: string[]): unknown => {
  if (!o) return undefined
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

function toRole(raw: unknown, lane?: unknown): Role | null {
  const r = str(raw).toUpperCase()
  if (r === 'TOP' || r === 'JUNGLE' || r === 'MIDDLE' || r === 'BOTTOM' || r === 'UTILITY') return r
  if (r === 'MID') return 'MIDDLE'
  if (r === 'SUPPORT' || r === 'DUO_SUPPORT') return 'UTILITY'
  if (r === 'ADC' || r === 'CARRY' || r === 'DUO_CARRY') return 'BOTTOM'
  // formato antigo: lane + role
  const l = str(lane).toUpperCase()
  if (l === 'TOP') return 'TOP'
  if (l === 'JUNGLE') return 'JUNGLE'
  if (l === 'MID' || l === 'MIDDLE') return 'MIDDLE'
  if (l === 'BOTTOM' || l === 'BOT') {
    if (r === 'DUO_SUPPORT' || r === 'SUPPORT') return 'UTILITY'
    if (r === 'DUO_CARRY' || r === 'CARRIER') return 'BOTTOM'
  }
  return null
}

function toBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  const s = str(v).toLowerCase()
  if (s === 'win' || s === 'true') return true
  if (s === 'fail' || s === 'lose' || s === 'loss' || s === 'false') return false
  return null
}

interface Partial10 extends PgParticipant {
  ident: { puuid: string; summonerId: string; accountId: string }
}

function fromGame(game: Obj): { list: Partial10[]; winByTeam: Map<number, boolean> } {
  const idents = new Map<number, Obj>()
  for (const pi of arr(game.participantIdentities)) {
    if (isObj(pi)) idents.set(num(pi.participantId), isObj(pi.player) ? pi.player : {})
  }
  const winByTeam = new Map<number, boolean>()
  for (const t of arr(game.teams)) {
    if (!isObj(t)) continue
    const w = toBool(pick(t, ['win', 'isWinningTeam']))
    if (w !== null) winByTeam.set(num(t.teamId), w)
  }
  const list: Partial10[] = []
  for (const raw of arr(game.participants)) {
    if (!isObj(raw)) continue
    const stats = isObj(raw.stats) ? raw.stats : raw // Match-v5 põe tudo no próprio participante
    const tl = isObj(raw.timeline) ? raw.timeline : undefined
    const id = num(pick(raw, ['participantId']))
    const player = idents.get(id) ?? {}
    const teamId = num(raw.teamId)
    const game_name = str(pick(player, ['gameName']))
    const name = game_name ? `${game_name}${str(player.tagLine) ? '#' + str(player.tagLine) : ''}` : str(pick(player, ['summonerName', 'riotIdGameName']) ?? pick(raw, ['summonerName', 'riotIdGameName']))
    const win = toBool(stats.win) ?? winByTeam.get(teamId) ?? false
    list.push({
      id,
      teamId,
      championId: num(raw.championId),
      name,
      role: toRole(pick(raw, ['teamPosition', 'individualPosition']), pick(tl, ['lane'])) ?? toRole(pick(tl, ['role']), pick(tl, ['lane'])),
      isMe: false,
      kills: num(pick(stats, ['kills'])),
      deaths: num(pick(stats, ['deaths'])),
      assists: num(pick(stats, ['assists'])),
      cs: num(pick(stats, ['totalMinionsKilled', 'minionsKilled'])),
      jungleCs: num(pick(stats, ['neutralMinionsKilled'])),
      gold: num(pick(stats, ['goldEarned'])),
      damage: num(pick(stats, ['totalDamageDealtToChampions'])),
      visionScore: num(pick(stats, ['visionScore'])),
      wardsPlaced: num(pick(stats, ['wardsPlaced'])),
      wardsKilled: num(pick(stats, ['wardsKilled'])),
      win,
      ident: { puuid: str(player.puuid), summonerId: str(player.summonerId), accountId: str(pick(player, ['currentAccountId', 'accountId'])) }
    })
  }
  return { list, winByTeam }
}

/** Placar final do cliente (eog-stats-block): nomes de estatística em MAIÚSCULAS. */
function fromEog(eog: Obj): Partial10[] {
  const list: Partial10[] = []
  let n = 0
  for (const t of arr(eog.teams)) {
    if (!isObj(t)) continue
    const teamId = num(t.teamId)
    const teamWin = toBool(pick(t, ['isWinningTeam', 'win'])) ?? false
    for (const p of arr(t.players)) {
      if (!isObj(p)) continue
      const s = isObj(p.stats) ? p.stats : {}
      n++
      list.push({
        id: n,
        teamId,
        championId: num(p.championId),
        name: str(pick(p, ['summonerName', 'riotIdGameName'])),
        role: toRole(pick(p, ['selectedPosition', 'teamPosition'])),
        isMe: false,
        kills: num(s.CHAMPIONS_KILLED),
        deaths: num(s.NUM_DEATHS),
        assists: num(s.ASSISTS),
        cs: num(s.MINIONS_KILLED),
        jungleCs: num(s.NEUTRAL_MINIONS_KILLED),
        gold: num(s.GOLD_EARNED),
        damage: num(s.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS),
        visionScore: num(s.VISION_SCORE),
        wardsPlaced: num(s.WARD_PLACED),
        wardsKilled: num(s.WARD_KILLED),
        win: teamWin,
        ident: { puuid: str(p.puuid), summonerId: str(p.summonerId), accountId: str(p.accountId) }
      })
    }
  }
  return list
}

/** Se o cliente não disser a rota de alguém, completa pelas rotas típicas do campeão. */
function fillRoles(list: PgParticipant[], champKeyOf: (id: number) => string | null): void {
  for (const team of new Set(list.map((p) => p.teamId))) {
    const mates = list.filter((p) => p.teamId === team)
    const taken = new Set(mates.map((p) => p.role).filter((r): r is Role => r !== null))
    const free = (['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as Role[]).filter((r) => !taken.has(r))
    for (const p of mates.filter((m) => m.role === null)) {
      const key = champKeyOf(p.championId)
      const likely = key ? CHAMPION_TRAITS[key]?.positions ?? [] : []
      const role = likely.find((r) => free.includes(r)) ?? free[0] ?? null
      if (role) {
        p.role = role
        free.splice(free.indexOf(role), 1)
      }
    }
  }
}

const EVENT_KIND: Record<string, PgEventKind> = {
  DRAGON: 'DRAGON',
  ELDER_DRAGON: 'DRAGON',
  RIFTHERALD: 'HERALD',
  BARON_NASHOR: 'BARON',
  HORDE: 'GRUBS',
  VOIDGRUB: 'GRUBS'
}

function parseTimeline(tl: unknown, teamOf: (id: number) => number | null): { frames: PgFrame[]; events: PgEvent[] } {
  const root = isObj(tl) ? tl : {}
  const info = isObj(root.info) ? root.info : root
  const rawFrames = arr(info.frames)
  const frames: PgFrame[] = []
  const events: PgEvent[] = []
  let lastMinute = -1
  for (const f of rawFrames) {
    if (!isObj(f)) continue
    const ts = num(f.timestamp)
    const minute = Math.round(ts / 60000)
    if (minute !== lastMinute) {
      const players: Record<number, PgFramePlayer> = {}
      const pf = isObj(f.participantFrames) ? f.participantFrames : {}
      for (const [k, v] of Object.entries(pf)) {
        if (!isObj(v)) continue
        const id = num(pick(v, ['participantId']) ?? k)
        players[id] = {
          cs: num(v.minionsKilled),
          jungle: num(v.jungleMinionsKilled),
          gold: num(pick(v, ['totalGold'])),
          xp: num(v.xp),
          level: num(v.level)
        }
      }
      if (Object.keys(players).length > 0) frames.push({ minute, players })
      lastMinute = minute
    }
    for (const e of arr(f.events)) {
      if (!isObj(e)) continue
      const t = num(e.timestamp) / 1000
      const type = str(e.type)
      const assists = arr(e.assistingParticipantIds).map((x) => num(x)).filter((x) => x > 0)
      if (type === 'CHAMPION_KILL') {
        const killer = num(e.killerId)
        const victim = num(e.victimId)
        const killerTeam = killer > 0 ? teamOf(killer) : null
        const victimTeam = teamOf(victim)
        events.push({
          t,
          kind: 'KILL',
          teamId: killerTeam ?? (victimTeam === 100 ? 200 : victimTeam === 200 ? 100 : null),
          actorId: killer > 0 ? killer : null,
          victimId: victim > 0 ? victim : null,
          assists
        })
      } else if (type === 'ELITE_MONSTER_KILL') {
        const kind = EVENT_KIND[str(e.monsterType).toUpperCase()]
        if (!kind) continue
        const killer = num(e.killerId)
        events.push({ t, kind, teamId: num(e.killerTeamId) || (killer > 0 ? teamOf(killer) : null), actorId: killer > 0 ? killer : null, victimId: null, assists })
      } else if (type === 'BUILDING_KILL') {
        const b = str(e.buildingType).toUpperCase()
        const kind: PgEventKind | null = b.startsWith('TOWER') ? 'TOWER' : b.startsWith('INHIBITOR') ? 'INHIBITOR' : null
        if (!kind) continue
        const lost = num(e.teamId)
        const killer = num(e.killerId)
        events.push({ t, kind, teamId: lost === 100 ? 200 : lost === 200 ? 100 : killer > 0 ? teamOf(killer) : null, actorId: killer > 0 ? killer : null, victimId: null, assists })
      }
    }
  }
  return { frames, events }
}

export interface NormalizeOptions {
  /** id numérico do campeão -> chave do Data Dragon (ex.: 64 -> "LeeSin"), para completar rotas ausentes */
  champKeyOf?: (id: number) => string | null
}

export function normalizeMatch(raw: RawMatch, opts: NormalizeOptions = {}): MatchReport | null {
  const game = isObj(raw.game) && arr(raw.game.participants).length > 0 ? raw.game : null
  const eog = isObj(raw.eog) ? raw.eog : null
  if (!game && !eog) return null

  let list: Partial10[] = game ? fromGame(game).list : eog ? fromEog(eog) : []
  if (list.length === 0 && eog) list = fromEog(eog)
  if (list.length === 0) return null

  const gameId = num(pick(game ?? undefined, ['gameId']) ?? pick(eog ?? undefined, ['gameId']))
  const durationRaw = num(pick(game ?? undefined, ['gameDuration']) ?? pick(eog ?? undefined, ['gameLength']))
  // Match-v5 dá milissegundos em alguns casos; o cliente costuma dar segundos
  const durationSec = durationRaw > 20000 ? durationRaw / 1000 : durationRaw
  const created = num(pick(game ?? undefined, ['gameCreation', 'gameStartTimestamp']))

  // ---- quem sou eu
  const me = raw.me ?? {}
  const nameEq = (a: string, b?: string): boolean => !!b && !!a && a.toLowerCase().split('#')[0] === b.toLowerCase().split('#')[0]
  let mine: Partial10 | undefined =
    list.find((p) => !!me.puuid && p.ident.puuid === me.puuid) ??
    list.find((p) => me.summonerId !== undefined && str(me.summonerId) !== '' && p.ident.summonerId === str(me.summonerId)) ??
    list.find((p) => me.accountId !== undefined && str(me.accountId) !== '' && p.ident.accountId === str(me.accountId)) ??
    list.find((p) => nameEq(p.name, me.name))
  if (!mine && eog && isObj(eog.localPlayer)) {
    const lp = eog.localPlayer
    mine = list.find((p) => p.championId === num(lp.championId) && (num(lp.teamId) === 0 || p.teamId === num(lp.teamId)))
  }
  if (mine) mine.isMe = true

  const participants: PgParticipant[] = list.map((p) => {
    const { ident, ...rest } = p
    void ident
    return rest
  })
  fillRoles(participants, opts.champKeyOf ?? (() => null))

  // quando só temos o placar final (sem participantId do jogo) a timeline não tem como casar com ninguém
  const timelineUsable = !!game && raw.timeline !== undefined && raw.timeline !== null
  const teamOf = (id: number): number | null => participants.find((p) => p.id === id)?.teamId ?? null
  const parsed = timelineUsable ? parseTimeline(raw.timeline, teamOf) : { frames: [] as PgFrame[], events: [] as PgEvent[] }

  const myTeam = participants.find((p) => p.isMe)
  return {
    gameId,
    queueId: num(pick(game ?? undefined, ['queueId'])),
    mode: str(pick(game ?? undefined, ['gameMode']) ?? pick(eog ?? undefined, ['gameMode'])),
    durationSec,
    playedAt: created > 0 ? created : null,
    win: myTeam ? myTeam.win : null,
    participants,
    frames: parsed.frames,
    events: parsed.events,
    hasTimeline: parsed.frames.length >= 3
  }
}

/** Procura ids de partida em qualquer formato de lista que o cliente devolver (do mais novo ao mais antigo). */
export function findGameIds(data: unknown, limit = 20): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  const walk = (v: unknown, depth: number): void => {
    if (out.length >= limit || depth > 5) return
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1))
    if (!isObj(v)) return
    const id = num(v.gameId)
    if (id > 0 && !seen.has(id)) {
      seen.add(id)
      out.push(id)
      return
    }
    for (const x of Object.values(v)) walk(x, depth + 1)
  }
  walk(data, 0)
  return out
}
