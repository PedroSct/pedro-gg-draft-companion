// tools/meta/aggregate.ts
// Transforma partidas do Match-v5 (e suas timelines) em estatísticas e builds.
// Tudo aqui é função pura sobre um estado serializável, então dá para retomar uma coleta interrompida.
import type { Role } from '../../src/shared/types'
import type { BuildOption, BuildOptions, BuildVariant, ChampionBuild, ChampionProfile, RunePage, SkillKey, MetaDataset, RoleMeta, SituationalItem, WinStats } from '../../src/shared/dataTypes'

// ------------------------------------------------------------ tipos crus da API (só o que usamos)

export interface RawParticipant {
  participantId: number
  championId: number
  teamId: number
  teamPosition?: string
  win: boolean
  physicalDamageDealtToChampions?: number
  magicDamageDealtToChampions?: number
  trueDamageDealtToChampions?: number
  totalDamageTaken?: number
  damageSelfMitigated?: number
  timeCCingOthers?: number
  summoner1Id?: number
  summoner2Id?: number
  perks?: {
    statPerks?: { defense?: number; flex?: number; offense?: number }
    styles?: { description?: string; style?: number; selections?: { perk?: number }[] }[]
  }
}
export interface RawMatch {
  info?: {
    gameVersion?: string
    queueId?: number
    gameDuration?: number
    gameEndedInEarlySurrender?: boolean
    participants?: RawParticipant[]
  }
}
export interface RawEvent {
  type?: string
  participantId?: number
  skillSlot?: number
  levelUpType?: string
  itemId?: number
  beforeId?: number
  afterId?: number
  timestamp?: number
}
export interface RawTimeline {
  info?: { frames?: { events?: RawEvent[] }[] }
}

// ------------------------------------------------------------------------------- estado

export type Counter = Record<string, number>
export interface CoreStat {
  count: number
  /** soma da posição (0, 1, 2) em que o item foi completado, para ordenar a compra */
  posSum: number
}
/** Todas as partidas (vitória ou derrota), com vitórias: sustenta as opções com escolha e winrate. */
export interface BuildOpts {
  /** participantes com timeline analisada */
  timeline: number
  runes: Record<string, WinStats>
  spells: Record<string, WinStats>
  starting: Record<string, WinStats>
  boots: Record<string, WinStats>
  core: Record<string, WinStats>
  /** "prioridade|9 primeiros níveis" */
  skills: Record<string, WinStats>
}
export const newOpts = (): BuildOpts => ({ timeline: 0, runes: {}, spells: {}, starting: {}, boots: {}, core: {}, skills: {} })

export interface BuildAgg {
  /** todas as partidas, não só as vitórias (ausente em checkpoints antigos) */
  opts?: BuildOpts
  /** vitórias com timeline analisadas */
  samples: number
  priority: Counter
  skillPrefix: Counter
  starting: Counter
  boots: Counter
  core: Record<string, CoreStat>
  other: Counter
  /** "estiloPrincipal|estiloSecundário|p1,p2,…,p9" → vitórias (ausente em checkpoints antigos) */
  runes?: Counter
  /** "feitiçoA,feitiçoB" (ordenados) → vitórias */
  spells?: Counter
  /** "a,b,c|botas" (3 primeiros itens completos em ordem de compra) → vitórias */
  variants?: Counter
}
/** Somas para o perfil de um campeão (dano por tipo, tanque e CC). */
export interface ProfAgg {
  n: number
  minutes: number
  physical: number
  magic: number
  true: number
  /** dano sofrido + mitigado */
  absorbed: number
  cc: number
}
export interface RoleAgg extends WinStats {
  matchups: Record<string, WinStats>
  /** chave = campeão aliado (qualquer rota). Ausente em checkpoints antigos. */
  synergies?: Record<string, WinStats>
  /** chave = campeão inimigo (qualquer rota). Ausente em checkpoints antigos. */
  versus?: Record<string, WinStats>
  prof?: ProfAgg
  build: BuildAgg
}
export interface AggState {
  schemaVersion: 1
  patch: string
  matches: number
  /** partidas com timeline baixada (ausente em checkpoints antigos) */
  timelineMatches?: number
  champions: Record<string, Partial<Record<Role, RoleAgg>>>
}
export interface ItemRules {
  /** itens completos (lendários) da Summoner's Rift */
  completed: Set<number>
  /** botas de 2º nível em diante */
  boots: Set<number>
}

const ROLE_OF: Record<string, Role> = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MIDDLE', BOTTOM: 'BOTTOM', UTILITY: 'UTILITY' }
const SOLO_QUEUE = 420
const MIN_DURATION_S = 300
const STARTING_WINDOW_MS = 60_000
const SKILL_LETTERS = 'QWER'
const MIN_LEVELS_FOR_BUILD = 14
const PREFIX_LEVELS = 9

export const newState = (patch: string): AggState => ({ schemaVersion: 1, patch, matches: 0, champions: {} })

const emptyBuild = (): BuildAgg => ({ samples: 0, priority: {}, skillPrefix: {}, starting: {}, boots: {}, core: {}, other: {} })
const emptyRole = (): RoleAgg => ({ games: 0, wins: 0, matchups: {}, synergies: {}, build: emptyBuild() })

function roleAgg(state: AggState, championId: number, role: Role): RoleAgg {
  const champ = (state.champions[String(championId)] ??= {})
  return (champ[role] ??= emptyRole())
}

const bump = (c: Counter, key: string, by = 1): void => {
  c[key] = (c[key] ?? 0) + by
}

const tally = (c: Record<string, WinStats>, key: string, win: boolean): void => {
  const s = (c[key] ??= { games: 0, wins: 0 })
  s.games++
  if (win) s.wins++
}

/** "16.20.612.4409" → "16.20" */
export const patchOf = (gameVersion: string): string => gameVersion.split('.').slice(0, 2).join('.')

// ------------------------------------------------------------------- regras de ddragon

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

export function itemRulesFrom(itemJson: unknown): ItemRules {
  const rules: ItemRules = { completed: new Set(), boots: new Set() }
  if (!isRecord(itemJson) || !isRecord(itemJson.data)) throw new Error('item.json inesperado')
  for (const [rawId, it] of Object.entries(itemJson.data)) {
    const id = Number(rawId)
    if (!Number.isInteger(id) || !isRecord(it)) continue
    const tags = Array.isArray(it.tags) ? it.tags.filter((t): t is string => typeof t === 'string') : []
    const gold = isRecord(it.gold) ? it.gold : {}
    const total = typeof gold.total === 'number' ? gold.total : 0
    const purchasable = gold.purchasable !== false
    const onRift = isRecord(it.maps) ? it.maps['11'] === true : true
    const hasInto = Array.isArray(it.into) && it.into.length > 0
    const hasFrom = Array.isArray(it.from) && it.from.length > 0
    if (!onRift || hasInto) continue
    if (tags.includes('Boots')) {
      if (hasFrom) rules.boots.add(id)
    } else if (purchasable && total >= 2000 && !tags.includes('Consumable') && !tags.includes('Trinket')) {
      rules.completed.add(id)
    }
  }
  return rules
}

// -------------------------------------------------------------- aceitação de partidas

/** Devolve os participantes se a partida serve para estatística; null se deve ser ignorada. */
export function acceptMatch(match: RawMatch, patch: string): RawParticipant[] | null {
  const info = match.info
  if (!info || !Array.isArray(info.participants) || info.participants.length !== 10) return null
  if (info.queueId !== SOLO_QUEUE) return null
  if (info.gameEndedInEarlySurrender === true) return null // remake
  if (typeof info.gameDuration !== 'number' || info.gameDuration < MIN_DURATION_S) return null
  if (typeof info.gameVersion !== 'string' || patchOf(info.gameVersion) !== patch) return null
  return info.participants
}

// ------------------------------------------------------------------ ordem de habilidades

const allowedUltimates = (level: number): number => (level >= 16 ? 3 : level >= 11 ? 2 : level >= 6 ? 1 : 0)

/**
 * Sequência possível no jogo? Máx. 18 níveis, Q/W/E até 5 pontos (e no máximo ceil(nível/2) em cada),
 * ultimate só nos níveis 6, 11 e 16. Serve de rede de proteção contra eventos duplicados
 * ou "fantasmas" na timeline da Riot: o que não é possível é descartado, nunca "consertado".
 */
export function isValidSkillSequence(seq: string): boolean {
  if (seq.length === 0 || seq.length > 18) return false
  const count: Record<string, number> = { Q: 0, W: 0, E: 0, R: 0 }
  for (let i = 0; i < seq.length; i++) {
    const k = seq[i]
    if (!(k in count)) return false
    count[k]++
    const level = i + 1
    if (k === 'R') {
      if (count.R > allowedUltimates(level)) return false
    } else if (count[k] > 5 || count[k] > Math.ceil(level / 2)) {
      return false
    }
  }
  return true
}

/**
 * Regra frouxa para campeões com habilidades fora do padrão (Udyr, Jayce, Aphelios, Zeri…): continua barrando
 * o que é impossível em qualquer campeão (mais de 18 níveis ou pontos demais numa habilidade), mas não exige
 * ultimate só nos níveis 6/11/16 nem o limite de metade dos níveis.
 */
export function isPlausibleSkillSequence(seq: string): boolean {
  if (seq.length === 0 || seq.length > 18) return false
  const count: Record<string, number> = { Q: 0, W: 0, E: 0, R: 0 }
  for (const k of seq) {
    if (!(k in count)) return false
    count[k]++
  }
  return count.Q <= 5 && count.W <= 5 && count.E <= 5 && count.R <= 5
}

/** Sequência de letras (ex.: "QWEQQR…") do jogador, ou null se a timeline não for confiável. */
export function extractSkillSequence(events: RawEvent[], participantId: number): string | null {
  const seen = new Set<string>()
  let seq = ''
  for (const ev of events) {
    if (ev.type !== 'SKILL_LEVEL_UP' || ev.participantId !== participantId || ev.levelUpType !== 'NORMAL') continue
    const slot = ev.skillSlot
    if (typeof slot !== 'number' || !(slot >= 1 && slot <= 4)) continue
    const key = `${slot}|${ev.timestamp}`
    if (seen.has(key)) continue // cópia idêntica no mesmo instante
    seen.add(key)
    seq += SKILL_LETTERS[slot - 1]
  }
  return isValidSkillSequence(seq) || isPlausibleSkillSequence(seq) ? seq : null
}

/** "RQEW": R primeiro; depois Q/W/E na ordem em que chegam ao nível máximo. */
export function priorityOf(seq: string): string {
  const reached: Record<string, number> = {}
  const count: Record<string, number> = { Q: 0, W: 0, E: 0 }
  for (let i = 0; i < seq.length; i++) {
    const k = seq[i]
    if (k === 'R') continue
    count[k]++
    if (count[k] === 5) reached[k] = i + 1
  }
  const order = ['Q', 'W', 'E'].sort((a, b) => {
    const ra = reached[a] ?? Infinity
    const rb = reached[b] ?? Infinity
    if (ra !== rb) return ra - rb
    if (count[a] !== count[b]) return count[b] - count[a]
    return seq.indexOf(a) - seq.indexOf(b)
  })
  return `R${order.join('')}`
}

/** Completa os níveis até 18 seguindo a prioridade, sem quebrar nenhuma regra do jogo. */
export function fillLevels(prefix: string, priority: string): string {
  const count: Record<string, number> = { Q: 0, W: 0, E: 0, R: 0 }
  for (const k of prefix) count[k]++
  let seq = prefix
  for (let level = prefix.length + 1; level <= 18; level++) {
    let pick: string | undefined
    if (count.R < allowedUltimates(level)) pick = 'R'
    else pick = [...priority].filter((k) => k !== 'R').find((k) => count[k] < 5 && count[k] < Math.ceil(level / 2))
    pick ??= 'QWE'.split('').find((k) => count[k] < 5 && count[k] < Math.ceil(level / 2))
    if (!pick) return prefix // não deveria acontecer; devolve só o que é confiável
    count[pick]++
    seq += pick
  }
  return seq
}

// ------------------------------------------------------------------------------- itens

export function extractPurchases(events: RawEvent[], participantId: number): { itemId: number; t: number }[] {
  const list: { itemId: number; t: number }[] = []
  for (const ev of events) {
    if (ev.participantId !== participantId) continue
    if (ev.type === 'ITEM_PURCHASED' && typeof ev.itemId === 'number' && ev.itemId > 0) {
      list.push({ itemId: ev.itemId, t: ev.timestamp ?? 0 })
    } else if (ev.type === 'ITEM_UNDO' && typeof ev.beforeId === 'number' && ev.beforeId > 0) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].itemId === ev.beforeId) {
          list.splice(i, 1)
          break
        }
      }
    }
  }
  return list
}

// ------------------------------------------------------------------- runas e feitiços

/** "principal|secundária|9 ids" na ordem do cliente, ou null se a página estiver incompleta. */
export function runeKeyOf(p: RawParticipant): string | null {
  const styles = p.perks?.styles
  const sp = p.perks?.statPerks
  if (!Array.isArray(styles) || !sp) return null
  const primary = styles.find((x) => x.description === 'primaryStyle') ?? styles[0]
  const sub = styles.find((x) => x.description === 'subStyle') ?? styles[1]
  const pick = (st: typeof primary): number[] => (st?.selections ?? []).map((x) => x.perk ?? 0)
  const main = pick(primary)
  const second = pick(sub)
  const shards = [sp.offense, sp.flex, sp.defense].map((n) => n ?? 0)
  if (!primary?.style || !sub?.style || main.length !== 4 || second.length !== 2) return null
  const all = [...main, ...second, ...shards]
  if (all.some((n) => !(n > 0)) || primary.style === sub.style) return null
  return `${primary.style}|${sub.style}|${all.join(',')}`
}

export function spellKeyOf(p: RawParticipant): string | null {
  const a = p.summoner1Id
  const b = p.summoner2Id
  if (!(typeof a === 'number' && typeof b === 'number' && a > 0 && b > 0 && a !== b)) return null
  return [a, b].sort((x, y) => x - y).join(',')
}

// ----------------------------------------------------------------------- adicionar partida

const toRole = (position: string | undefined): Role | null => ROLE_OF[position ?? ''] ?? null

/** Soma uma partida ao estado. Devolve true se ela foi contada. */
export function addMatch(state: AggState, match: RawMatch, timeline: RawTimeline | null, rules: ItemRules): boolean {
  const participants = acceptMatch(match, state.patch)
  if (!participants) return false
  state.matches++

  const byRole = new Map<Role, RawParticipant[]>()
  for (const p of participants) {
    const role = toRole(p.teamPosition)
    if (!role || !(p.championId > 0)) continue
    const agg = roleAgg(state, p.championId, role)
    agg.games++
    if (p.win) agg.wins++
    byRole.set(role, [...(byRole.get(role) ?? []), p])
  }

  // Sinergia: cada campeão com cada aliado do mesmo time (em qualquer rota).
  for (const me of participants) {
    const role = toRole(me.teamPosition)
    if (!role || !(me.championId > 0)) continue
    const table = (roleAgg(state, me.championId, role).synergies ??= {})
    for (const mate of participants) {
      if (mate.participantId === me.participantId || mate.teamId !== me.teamId || !(mate.championId > 0)) continue
      const st = (table[String(mate.championId)] ??= { games: 0, wins: 0 })
      st.games++
      if (me.win) st.wins++
    }
  }

  // Contra o time inimigo inteiro (qualquer rota) e perfil real de dano/tanque/CC.
  const minutes = (match.info?.gameDuration ?? 0) / 60
  const num = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  for (const me of participants) {
    const role = toRole(me.teamPosition)
    if (!role || !(me.championId > 0)) continue
    const agg = roleAgg(state, me.championId, role)
    const table = (agg.versus ??= {})
    for (const foe of participants) {
      if (foe.teamId === me.teamId || !(foe.championId > 0)) continue
      const st = (table[String(foe.championId)] ??= { games: 0, wins: 0 })
      st.games++
      if (me.win) st.wins++
    }
    const prof = (agg.prof ??= { n: 0, minutes: 0, physical: 0, magic: 0, true: 0, absorbed: 0, cc: 0 })
    const dealt = num(me.physicalDamageDealtToChampions) + num(me.magicDamageDealtToChampions) + num(me.trueDamageDealtToChampions)
    if (minutes > 0 && dealt > 0) {
      prof.n++
      prof.minutes += minutes
      prof.physical += num(me.physicalDamageDealtToChampions)
      prof.magic += num(me.magicDamageDealtToChampions)
      prof.true += num(me.trueDamageDealtToChampions)
      prof.absorbed += num(me.totalDamageTaken) + num(me.damageSelfMitigated)
      prof.cc += num(me.timeCCingOthers)
    }
  }

  // Confronto direto: só quando cada time tem exatamente um jogador na rota.
  for (const [role, list] of byRole) {
    if (list.length !== 2 || list[0].teamId === list[1].teamId) continue
    const [a, b] = list
    for (const [me, other] of [[a, b], [b, a]] as const) {
      const mu = (roleAgg(state, me.championId, role).matchups[String(other.championId)] ??= { games: 0, wins: 0 })
      mu.games++
      if (me.win) mu.wins++
    }
  }

  // Runas e feitiços vêm da própria partida (não precisam da timeline). O padrão usa só as vitórias;
  // as opções com escolha e winrate usam todos os jogadores.
  for (const p of participants) {
    const role = toRole(p.teamPosition)
    if (!role || !(p.championId > 0)) continue
    const build = roleAgg(state, p.championId, role).build
    const opts = (build.opts ??= newOpts())
    const rk = runeKeyOf(p)
    const sk = spellKeyOf(p)
    if (rk) tally(opts.runes, rk, p.win)
    if (sk) tally(opts.spells, sk, p.win)
    if (!p.win) continue
    if (rk) bump((build.runes ??= {}), rk)
    if (sk) bump((build.spells ??= {}), sk)
  }

  if (!timeline) return true
  state.timelineMatches = (state.timelineMatches ?? 0) + 1
  const events = (timeline.info?.frames ?? []).flatMap((f) => f.events ?? [])
  for (const p of participants) {
    const role = toRole(p.teamPosition)
    if (!role || !(p.championId > 0)) continue
    const build = roleAgg(state, p.championId, role).build
    const opts = (build.opts ??= newOpts())
    opts.timeline++

    const seq = extractSkillSequence(events, p.participantId)
    const purchases = extractPurchases(events, p.participantId)
    const starting = purchases.filter((x) => x.t <= STARTING_WINDOW_MS).map((x) => x.itemId).sort((x, y) => x - y)
    const firstBoots = purchases.find((x) => rules.boots.has(x.itemId))
    const completed: number[] = []
    for (const x of purchases) if (rules.completed.has(x.itemId) && !completed.includes(x.itemId)) completed.push(x.itemId)

    // Todos os jogadores: opções com escolha e winrate
    if (seq && seq.length >= MIN_LEVELS_FOR_BUILD) tally(opts.skills, `${priorityOf(seq)}|${seq.slice(0, PREFIX_LEVELS)}`, p.win)
    if (starting.length) tally(opts.starting, starting.join(','), p.win)
    if (firstBoots) tally(opts.boots, String(firstBoots.itemId), p.win)
    if (completed.length >= 3) tally(opts.core, completed.slice(0, 3).join(','), p.win)

    // Só as vitórias: build padrão (importar para o cliente)
    if (!p.win) continue
    build.samples++
    if (seq && seq.length >= MIN_LEVELS_FOR_BUILD) {
      const priority = priorityOf(seq)
      bump(build.priority, priority)
      bump(build.skillPrefix, `${priority}|${seq.slice(0, PREFIX_LEVELS)}`)
    }
    if (starting.length) bump(build.starting, starting.join(','))
    if (firstBoots) bump(build.boots, String(firstBoots.itemId))
    if (completed.length >= 3) bump((build.variants ??= {}), `${completed.slice(0, 3).join(',')}|${firstBoots ? firstBoots.itemId : 0}`)
    completed.forEach((id, idx) => {
      if (idx < 3) {
        const stat = (build.core[String(id)] ??= { count: 0, posSum: 0 })
        stat.count++
        stat.posSum += idx
      } else {
        bump(build.other, String(id))
      }
    })
  }
  return true
}

// ----------------------------------------------------------------------------- finalizar

export interface FinalizeOptions {
  /** jogos mínimos de um campeão numa rota para entrar no dataset */
  minGames: number
  /** jogos mínimos de um confronto para entrar */
  minMatchupGames: number
  /** jogos mínimos de uma sinergia ou de um "contra o time inimigo" (padrão: o mesmo dos confrontos) */
  minPairGames?: number
  /** vitórias com habilidades válidas para publicar uma build */
  minBuildSamples: number
  source: string
  generatedAt: string
  /** servidores que entraram nas estatísticas */
  regions?: string[]
}

const top = (c: Counter): string | null => {
  let best: string | null = null
  for (const [k, v] of Object.entries(c)) if (best === null || v > c[best] || (v === c[best] && k < best)) best = k
  return best
}
const total = (c: Counter): number => Object.values(c).reduce((s, n) => s + n, 0)

/** As opções mais escolhidas de uma parte da build, com escolha e vitórias (só o que tem amostra mínima). */
function topOptions<T>(
  table: Record<string, WinStats> | undefined,
  limit: number,
  parse: (key: string, stats: WinStats) => T | null
): BuildOption<T>[] {
  const rows = Object.entries(table ?? {}).sort((x, y) => y[1].games - x[1].games || (x[0] < y[0] ? -1 : 1))
  const sum = rows.reduce((n, [, s]) => n + s.games, 0)
  const out: BuildOption<T>[] = []
  for (const [key, s] of rows) {
    if (out.length >= limit) break
    // A primeira sempre entra; as demais precisam de amostra e de pelo menos 3% das escolhas
    if (out.length > 0 && (s.games < 3 || s.games / Math.max(1, sum) < 0.03)) continue
    const value = parse(key, s)
    if (value !== null) out.push({ value, games: s.games, wins: s.wins })
  }
  return out
}

const ids = (key: string): number[] => key.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0)

function optionsFrom(opts: BuildOpts | undefined, games: number): BuildOptions | undefined {
  if (!opts) return undefined
  const runes = topOptions<RunePage>(opts.runes, 3, (key) => {
    const [primary, sub, list] = key.split('|')
    const perkIds = ids(list ?? '')
    return perkIds.length === 9 ? { primaryStyleId: Number(primary), subStyleId: Number(sub), perkIds } : null
  })
  const spells = topOptions<[number, number]>(opts.spells, 2, (key) => {
    const [a, b] = ids(key)
    return a && b ? [a, b] : null
  })
  const starting = topOptions<number[]>(opts.starting, 2, (key) => {
    const list = ids(key)
    return list.length ? list : null
  })
  const boots = topOptions<number>(opts.boots, 3, (key) => (Number(key) > 0 ? Number(key) : null))
  const core = topOptions<number[]>(opts.core, 4, (key) => {
    const list = ids(key)
    return list.length === 3 ? list : null
  })

  // Habilidades: soma por prioridade e usa o prefixo mais comum de cada uma para completar os 18 níveis
  const byPriority = new Map<string, { games: number; wins: number; prefix: string; best: number }>()
  for (const [key, s] of Object.entries(opts.skills)) {
    const [priority, prefix] = key.split('|')
    if (!priority || !prefix) continue
    const cur = byPriority.get(priority) ?? { games: 0, wins: 0, prefix, best: 0 }
    cur.games += s.games
    cur.wins += s.wins
    if (s.games > cur.best) {
      cur.best = s.games
      cur.prefix = prefix
    }
    byPriority.set(priority, cur)
  }
  const skillTable: Record<string, WinStats> = {}
  for (const [priority, v] of byPriority) skillTable[priority] = { games: v.games, wins: v.wins }
  const skills = topOptions<{ priority: SkillKey[]; levels?: SkillKey[] }>(skillTable, 3, (priority) => {
    const prefix = byPriority.get(priority)?.prefix ?? ''
    const full = fillLevels(prefix, priority)
    const levels = full.length === 18 && isValidSkillSequence(full) ? ([...full] as SkillKey[]) : undefined
    return { priority: [...priority] as SkillKey[], ...(levels ? { levels } : {}) }
  })

  const out: BuildOptions = {
    games,
    timeline: opts.timeline,
    ...(runes.length ? { runes } : {}),
    ...(spells.length ? { spells } : {}),
    ...(starting.length ? { starting } : {}),
    ...(boots.length ? { boots } : {}),
    ...(core.length ? { core } : {}),
    ...(skills.length ? { skills } : {})
  }
  return Object.keys(out).length > 2 ? out : undefined
}

function buildFrom(b: BuildAgg, minSamples: number, games: number): ChampionBuild | undefined {
  // Runas, feitiços e itens pedem menos amostra que a ordem de habilidades; nada depende de uma parte só.
  const lite = Math.min(minSamples, 6)

  const priorityKey = top(b.priority)
  let skillOrder: ChampionBuild['skillOrder']
  if (priorityKey && total(b.priority) >= minSamples) {
    // Prefixo de 9 níveis mais comum entre as partidas com essa prioridade
    const prefixes: Counter = {}
    for (const [k, v] of Object.entries(b.skillPrefix)) if (k.startsWith(`${priorityKey}|`)) prefixes[k.slice(priorityKey.length + 1)] = v
    const prefix = top(prefixes)
    let levels: string | undefined
    if (prefix) {
      const full = fillLevels(prefix, priorityKey)
      if (full.length === 18 && isValidSkillSequence(full)) levels = full
    }
    skillOrder = {
      priority: [...priorityKey] as NonNullable<ChampionBuild['skillOrder']>['priority'],
      ...(levels ? { levels: [...levels] as NonNullable<NonNullable<ChampionBuild['skillOrder']>['levels']> } : {})
    }
  }

  const enoughItems = b.samples >= lite
  const starting = enoughItems ? ids(top(b.starting) ?? '') : []
  const boots = enoughItems
    ? Object.entries(b.boots).sort((x, y) => y[1] - x[1] || Number(x[0]) - Number(y[0])).slice(0, 2).map(([id]) => Number(id))
    : []

  // Os 3 itens mais frequentes entre os 3 primeiros completados, ordenados pela posição média de compra
  const coreRanked = Object.entries(b.core).sort((x, y) => y[1].count - x[1].count || Number(x[0]) - Number(y[0]))
  const core = enoughItems
    ? coreRanked
        .slice(0, 3)
        .sort((x, y) => x[1].posSum / x[1].count - y[1].posSum / y[1].count || Number(x[0]) - Number(y[0]))
        .map(([id]) => Number(id))
    : []

  // Situacionais: o que mais aparece depois dos 3 principais (ou como alternativa a eles)
  const rest: Counter = { ...b.other }
  for (const [id, stat] of coreRanked.slice(3)) bump(rest, id, stat.count)
  const situational: SituationalItem[] = enoughItems
    ? Object.entries(rest)
        .sort((x, y) => y[1] - x[1] || Number(x[0]) - Number(y[0]))
        .slice(0, 5)
        .map(([id, n]) => ({ itemId: Number(id), when: `Comprado em ${Math.round((n / Math.max(1, b.samples)) * 100)}% das partidas vencidas` }))
    : []

  const runeKey = top(b.runes ?? {})
  let runes: ChampionBuild['runes']
  if (runeKey && total(b.runes ?? {}) >= lite) {
    const [primary, sub, list] = runeKey.split('|')
    const perkIds = ids(list)
    if (perkIds.length === 9) runes = { primaryStyleId: Number(primary), subStyleId: Number(sub), perkIds }
  }
  const spellKey = top(b.spells ?? {})
  const spells = spellKey && total(b.spells ?? {}) >= lite ? (ids(spellKey) as [number, number]) : undefined

  // Construções alternativas: as 3 mais usadas (a mais comum costuma coincidir com `items`)
  const variants: BuildVariant[] = Object.entries(b.variants ?? {})
    .filter(([, n]) => n >= 5 && b.samples > 0 && n / b.samples >= 0.06)
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
    .slice(0, 3)
    .map(([key, n]) => {
      const [items, boot] = key.split('|')
      const bootId = Number(boot)
      return {
        core: items.split(',').map(Number),
        ...(bootId > 0 ? { boots: bootId } : {}),
        share: Math.round((n / b.samples) * 1000) / 1000
      }
    })

  const options = optionsFrom(b.opts, games)
  const hasItems = core.length > 0 || starting.length > 0 || boots.length > 0
  if (!skillOrder && !runes && !spells && !hasItems && !options) return undefined

  return {
    ...(runes ? { runes } : {}),
    ...(spells ? { spells } : {}),
    ...(variants.length > 1 ? { variants } : {}),
    ...(options ? { options } : {}),
    ...(skillOrder ? { skillOrder } : {}),
    items: { starting, boots, core, situational }
  }
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000

function profileFrom(p: ProfAgg | undefined, minSamples: number): ChampionProfile | undefined {
  if (!p || p.n < minSamples || p.minutes <= 0) return undefined
  const dealt = p.physical + p.magic + p.true
  if (dealt <= 0) return undefined
  return {
    physical: round3(p.physical / dealt),
    magic: round3(p.magic / dealt),
    true: round3(p.true / dealt),
    durability: Math.round(p.absorbed / p.minutes),
    cc: round3(p.cc / p.minutes)
  }
}

// ----------------------------------------------------------------- juntar várias coletas

const addStats = (into: Record<string, WinStats>, from: Record<string, WinStats> | undefined): void => {
  for (const [k, s] of Object.entries(from ?? {})) {
    const t = (into[k] ??= { games: 0, wins: 0 })
    t.games += s.games
    t.wins += s.wins
  }
}
const addCounter = (into: Counter, from: Counter | undefined): void => {
  for (const [k, v] of Object.entries(from ?? {})) bump(into, k, v)
}

/**
 * Soma as coletas de vários servidores (mesmo patch) num estado só. Estados de outro patch são ignorados;
 * o chamador recebe a lista de quem entrou. Não altera os estados recebidos.
 */
export function mergeStates(states: AggState[]): { merged: AggState; used: number[]; skipped: number[] } {
  if (states.length === 0) throw new Error('Nenhuma coleta para juntar')
  const patch = states[0].patch
  const merged = newState(patch)
  const used: number[] = []
  const skipped: number[] = []
  states.forEach((s, i) => {
    if (s.patch !== patch) return void skipped.push(i)
    used.push(i)
    merged.matches += s.matches
    merged.timelineMatches = (merged.timelineMatches ?? 0) + (s.timelineMatches ?? 0)
    for (const [champId, roles] of Object.entries(s.champions)) {
      for (const [role, agg] of Object.entries(roles) as [Role, RoleAgg][]) {
        const t = roleAgg(merged, Number(champId), role)
        t.games += agg.games
        t.wins += agg.wins
        addStats(t.matchups, agg.matchups)
        addStats((t.synergies ??= {}), agg.synergies)
        addStats((t.versus ??= {}), agg.versus)
        if (agg.prof) {
          const p = (t.prof ??= { n: 0, minutes: 0, physical: 0, magic: 0, true: 0, absorbed: 0, cc: 0 })
          p.n += agg.prof.n
          p.minutes += agg.prof.minutes
          p.physical += agg.prof.physical
          p.magic += agg.prof.magic
          p.true += agg.prof.true
          p.absorbed += agg.prof.absorbed
          p.cc += agg.prof.cc
        }
        const b = t.build
        const from = agg.build
        b.samples += from.samples
        for (const k of ['priority', 'skillPrefix', 'starting', 'boots', 'other'] as const) addCounter(b[k], from[k])
        for (const [id, c] of Object.entries(from.core)) {
          const x = (b.core[id] ??= { count: 0, posSum: 0 })
          x.count += c.count
          x.posSum += c.posSum
        }
        addCounter((b.runes ??= {}), from.runes)
        addCounter((b.spells ??= {}), from.spells)
        addCounter((b.variants ??= {}), from.variants)
        if (from.opts) {
          const t = (b.opts ??= newOpts())
          t.timeline += from.opts.timeline
          for (const k of ['runes', 'spells', 'starting', 'boots', 'core', 'skills'] as const) addStats(t[k], from.opts[k])
        }
      }
    }
  })
  return { merged, used, skipped }
}

export function finalize(state: AggState, o: FinalizeOptions): MetaDataset {
  const champions: MetaDataset['champions'] = {}
  for (const [id, roles] of Object.entries(state.champions)) {
    const out: Partial<Record<Role, RoleMeta>> = {}
    for (const [role, agg] of Object.entries(roles) as [Role, RoleAgg][]) {
      if (agg.games < o.minGames) continue
      const matchups: Record<string, WinStats> = {}
      for (const [vs, s] of Object.entries(agg.matchups)) if (s.games >= o.minMatchupGames) matchups[vs] = { games: s.games, wins: s.wins }
      const synergies: Record<string, WinStats> = {}
      for (const [mate, s] of Object.entries(agg.synergies ?? {})) if (s.games >= (o.minPairGames ?? o.minMatchupGames)) synergies[mate] = { games: s.games, wins: s.wins }
      const versus: Record<string, WinStats> = {}
      for (const [foe, s] of Object.entries(agg.versus ?? {})) if (s.games >= (o.minPairGames ?? o.minMatchupGames)) versus[foe] = { games: s.games, wins: s.wins }
      const profile = profileFrom(agg.prof, 20)
      const build = buildFrom(agg.build, o.minBuildSamples, agg.games)
      out[role] = {
        games: agg.games,
        wins: agg.wins,
        matchups,
        ...(Object.keys(synergies).length ? { synergies } : {}),
        ...(Object.keys(versus).length ? { versus } : {}),
        ...(profile ? { profile } : {}),
        ...(build ? { build } : {})
      }
    }
    if (Object.keys(out).length) champions[id] = { roles: out }
  }
  return {
    schemaVersion: 1,
    source: o.source,
    isSample: false,
    patch: state.patch,
    generatedAt: o.generatedAt,
    ...(o.regions?.length ? { regions: o.regions } : {}),
    champions
  }
}
