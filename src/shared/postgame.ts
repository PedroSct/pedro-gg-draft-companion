// src/shared/postgame.ts
// Modelo da partida terminada e o motor de análise (código puro: roda no main e nos testes).
//
// A análise é um conjunto de regras explícitas sobre números que o cliente do LoL entrega
// (CS, ouro, XP, mortes, objetivos, visão). Não há "IA" aqui: cada dica diz o número que a gerou.
import type { Role } from './types'

// ------------------------------------------------------------------ partida normalizada

export interface PgParticipant {
  /** participantId do jogo, 1 a 10 */
  id: number
  /** 100 = azul, 200 = vermelho */
  teamId: number
  championId: number
  name: string
  role: Role | null
  isMe: boolean
  kills: number
  deaths: number
  assists: number
  /** tropas de rota */
  cs: number
  /** monstros da selva */
  jungleCs: number
  gold: number
  damage: number
  visionScore: number
  wardsPlaced: number
  wardsKilled: number
  win: boolean
  /** levava Golpe-fatal (Smite): sinal forte de caçador */
  smite?: boolean
}

export interface PgFramePlayer {
  cs: number
  jungle: number
  gold: number
  xp: number
  level: number
  /** posição no mapa (0 a ~14800); usada para descobrir a rota */
  pos?: [number, number]
}

export interface PgFrame {
  minute: number
  /** por participantId */
  players: Record<number, PgFramePlayer>
}

export type PgEventKind = 'KILL' | 'DRAGON' | 'HERALD' | 'BARON' | 'GRUBS' | 'TOWER' | 'INHIBITOR'

export interface PgEvent {
  /** segundos desde o início */
  t: number
  kind: PgEventKind
  /** time que ganhou com o evento (quem matou / quem destruiu) */
  teamId: number | null
  actorId: number | null
  victimId: number | null
  assists: number[]
}

export interface MatchReport {
  gameId: number
  queueId: number
  mode: string
  durationSec: number
  playedAt: number | null
  win: boolean | null
  participants: PgParticipant[]
  frames: PgFrame[]
  events: PgEvent[]
  hasTimeline: boolean
}

// ------------------------------------------------------------------ análise

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'
export type InsightLevel = 'good' | 'warn' | 'bad' | 'info'

export interface Insight {
  level: InsightLevel
  title: string
  detail: string
}

export type ComponentKey = 'farm' | 'laning' | 'fighting' | 'vision' | 'objectives' | 'survival'

export interface ScoreComponent {
  key: ComponentKey
  label: string
  /** 0 a 100 */
  score: number
  /** texto curto com o número que gerou a nota */
  note: string
}

export interface Diff {
  minute: number
  cs: number | null
  gold: number | null
  xp: number | null
}

export interface PhaseLine {
  label: string
  kills: number
  deaths: number
  assists: number
}

export interface ObjectiveLine {
  kind: PgEventKind
  label: string
  /** quantos o seu time pegou */
  team: number
  /** quantos o inimigo pegou */
  enemy: number
  /** em quantos você participou (matou ou ajudou) */
  mine: number
}

export interface Swing {
  minute: number
  /** variação da diferença de ouro entre os times (positivo = a favor do seu time) */
  delta: number
  text: string
}

export interface Analysis {
  gameId: number
  score: number
  grade: Grade
  role: Role | null
  opponentId: number | null
  components: ScoreComponent[]
  csPerMin: number
  killParticipation: number
  damageShare: number
  goldShare: number
  visionPerMin: number
  minutes: number[]
  /** você */
  me: { cs: number[]; gold: number[]; xp: number[] }
  /** oponente de rota (null sem timeline ou sem oponente identificado) */
  opp: { cs: number[]; gold: number[]; xp: number[] } | null
  /** ouro do seu time menos o do inimigo, por minuto */
  teamGoldDiff: number[]
  diffs: Diff[]
  phases: PhaseLine[]
  objectives: ObjectiveLine[]
  swings: Swing[]
  insights: Insight[]
}

// ------------------------------------------------------------------ constantes

export const ROLE_PT: Record<Role, string> = {
  TOP: 'Topo',
  JUNGLE: 'Selva',
  MIDDLE: 'Meio',
  BOTTOM: 'Atirador',
  UTILITY: 'Suporte'
}

/** Referências aproximadas de um jogo "bom" (não é meta oficial; só um ponto de comparação). */
const CS_TARGET: Record<Role, number> = { TOP: 6.8, JUNGLE: 5.6, MIDDLE: 7.2, BOTTOM: 7.6, UTILITY: 1.2 }
const VISION_TARGET: Record<Role, number> = { TOP: 0.9, JUNGLE: 1.3, MIDDLE: 0.9, BOTTOM: 0.9, UTILITY: 2.2 }

const WEIGHTS: Record<Role, Record<ComponentKey, number>> = {
  TOP: { farm: 0.2, laning: 0.25, fighting: 0.2, vision: 0.05, objectives: 0.1, survival: 0.2 },
  JUNGLE: { farm: 0.15, laning: 0.05, fighting: 0.25, vision: 0.15, objectives: 0.3, survival: 0.1 },
  MIDDLE: { farm: 0.2, laning: 0.2, fighting: 0.25, vision: 0.05, objectives: 0.1, survival: 0.2 },
  BOTTOM: { farm: 0.25, laning: 0.2, fighting: 0.25, vision: 0.05, objectives: 0.1, survival: 0.15 },
  UTILITY: { farm: 0, laning: 0.1, fighting: 0.25, vision: 0.3, objectives: 0.15, survival: 0.2 }
}
const DEFAULT_WEIGHTS = { farm: 0.2, laning: 0.15, fighting: 0.25, vision: 0.1, objectives: 0.15, survival: 0.15 }

const COMPONENT_LABEL: Record<ComponentKey, string> = {
  farm: 'Farm',
  laning: 'Rota',
  fighting: 'Lutas',
  vision: 'Visão',
  objectives: 'Objetivos',
  survival: 'Sobrevivência'
}

const OBJECTIVE_LABEL: Partial<Record<PgEventKind, string>> = {
  DRAGON: 'Dragões',
  HERALD: 'Arauto',
  GRUBS: 'Vermes do Vazio',
  BARON: 'Barão',
  TOWER: 'Torres',
  INHIBITOR: 'Inibidores'
}
const OBJECTIVE_KINDS: PgEventKind[] = ['DRAGON', 'HERALD', 'GRUBS', 'BARON', 'TOWER', 'INHIBITOR']

// ------------------------------------------------------------------ utilitários

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const r1 = (v: number): number => Math.round(v * 10) / 10
const pct = (v: number): string => `${Math.round(v * 100)}%`
const signed = (v: number): string => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`)

export function gradeOf(score: number): Grade {
  if (score >= 85) return 'S'
  if (score >= 72) return 'A'
  if (score >= 58) return 'B'
  if (score >= 42) return 'C'
  return 'D'
}

const totalCs = (p: PgFramePlayer): number => p.cs + p.jungle

function seriesOf(frames: PgFrame[], id: number | null): { cs: number[]; gold: number[]; xp: number[] } | null {
  if (id === null || frames.length === 0) return null
  const out = { cs: [] as number[], gold: [] as number[], xp: [] as number[] }
  for (const f of frames) {
    const p = f.players[id]
    if (!p) return null
    out.cs.push(totalCs(p))
    out.gold.push(p.gold)
    out.xp.push(p.xp)
  }
  return out
}

/** Quem enfrentou você na rota: a mesma posição do outro time (na selva, o outro caçador). */
export function findOpponent(report: MatchReport, me: PgParticipant): PgParticipant | null {
  if (!me.role) return null
  return report.participants.find((p) => p.teamId !== me.teamId && p.role === me.role) ?? null
}

// ------------------------------------------------------------------ análise principal

export function analyzeMatch(report: MatchReport): Analysis | null {
  const me = report.participants.find((p) => p.isMe)
  if (!me) return null

  const minutesPlayed = Math.max(1, report.durationSec / 60)
  const role = me.role
  const opp = findOpponent(report, me)
  const allies = report.participants.filter((p) => p.teamId === me.teamId)
  const enemies = report.participants.filter((p) => p.teamId !== me.teamId)
  const sum = (ps: PgParticipant[], f: (p: PgParticipant) => number): number => ps.reduce((a, p) => a + f(p), 0)

  const teamKills = sum(allies, (p) => p.kills)
  const kp = teamKills > 0 ? (me.kills + me.assists) / teamKills : 0
  const damageShare = (() => {
    const t = sum(allies, (p) => p.damage)
    return t > 0 ? me.damage / t : 0
  })()
  const goldShare = (() => {
    const t = sum(allies, (p) => p.gold)
    return t > 0 ? me.gold / t : 0
  })()
  const myCs = me.cs + me.jungleCs
  const csPerMin = myCs / minutesPlayed
  const visionPerMin = me.visionScore / minutesPlayed

  // ---- séries por minuto
  const frames = report.hasTimeline ? report.frames : []
  const minutes = frames.map((f) => f.minute)
  const meSeries = seriesOf(frames, me.id) ?? { cs: [], gold: [], xp: [] }
  const oppSeries = seriesOf(frames, opp?.id ?? null)
  const teamGoldDiff = frames.map((f) => {
    let a = 0
    let b = 0
    for (const p of report.participants) {
      const fp = f.players[p.id]
      if (!fp) continue
      if (p.teamId === me.teamId) a += fp.gold
      else b += fp.gold
    }
    return a - b
  })

  // ---- diferença para o oponente de rota em 10, 15 e 20 min
  const diffs: Diff[] = []
  if (oppSeries) {
    for (const m of [10, 15, 20]) {
      const i = minutes.indexOf(m)
      if (i < 0) continue
      diffs.push({
        minute: m,
        cs: meSeries.cs[i] - oppSeries.cs[i],
        gold: meSeries.gold[i] - oppSeries.gold[i],
        xp: meSeries.xp[i] - oppSeries.xp[i]
      })
    }
  }

  // ---- mortes/abates por fase
  const phaseDefs: [string, number, number][] = [
    ['Início (0–10 min)', 0, 600],
    ['Meio (10–20 min)', 600, 1200],
    ['Final (20+ min)', 1200, Infinity]
  ]
  const phases: PhaseLine[] = phaseDefs.map(([label, a, b]) => {
    const line: PhaseLine = { label, kills: 0, deaths: 0, assists: 0 }
    for (const e of report.events) {
      if (e.kind !== 'KILL' || e.t < a || e.t >= b) continue
      if (e.actorId === me.id) line.kills++
      if (e.victimId === me.id) line.deaths++
      if (e.assists.includes(me.id)) line.assists++
    }
    return line
  })
  const hasKillEvents = report.events.some((e) => e.kind === 'KILL')

  // ---- objetivos
  const objectives: ObjectiveLine[] = []
  for (const kind of OBJECTIVE_KINDS) {
    const evs = report.events.filter((e) => e.kind === kind)
    if (evs.length === 0) continue
    objectives.push({
      kind,
      label: OBJECTIVE_LABEL[kind] ?? kind,
      team: evs.filter((e) => e.teamId === me.teamId).length,
      enemy: evs.filter((e) => e.teamId !== null && e.teamId !== me.teamId).length,
      mine: evs.filter((e) => e.teamId === me.teamId && (e.actorId === me.id || e.assists.includes(me.id))).length
    })
  }

  // ---- viradas de ouro (maior variação da diferença entre os times em 2 min)
  const swings = findSwings(report, me, minutes, teamGoldDiff)

  // ---- componentes da nota
  const comps: ScoreComponent[] = []
  const add = (key: ComponentKey, score: number, note: string) =>
    comps.push({ key, label: COMPONENT_LABEL[key], score: Math.round(clamp(score, 0, 100)), note })

  const w = role ? WEIGHTS[role] : DEFAULT_WEIGHTS

  if (w.farm > 0) {
    const target = role ? CS_TARGET[role] : 6.5
    const ratio = csPerMin / target
    add('farm', (100 * (ratio - 0.4)) / 0.7, `${r1(csPerMin)} CS/min (referência ${target})`)
  }

  if (diffs.length > 0) {
    const early = diffs.filter((d) => d.minute <= 15)
    const use = early.length > 0 ? early : diffs
    const avg = (f: (d: Diff) => number | null): number => {
      const v = use.map(f).filter((x): x is number => x !== null)
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
    }
    const gd = avg((d) => d.gold)
    const cd = avg((d) => d.cs)
    add('laning', 50 + 35 * clamp(gd / 600, -1, 1) + 15 * clamp(cd / 15, -1, 1), `ouro ${signed(gd)} e CS ${signed(cd)} vs. oponente`)
  }

  {
    const kda = (me.kills + me.assists) / Math.max(1, me.deaths)
    const score = 0.5 * clamp(kp / 0.7, 0, 1) * 100 + 0.5 * clamp(kda / 4, 0, 1) * 100
    add('fighting', score, `${me.kills}/${me.deaths}/${me.assists}, participação ${pct(kp)}`)
  }

  {
    const target = role ? VISION_TARGET[role] : 0.9
    add('vision', (100 * (visionPerMin / target)) / 1.1, `${r1(visionPerMin)} visão/min (referência ${target})`)
  }

  {
    const objs = objectives.filter((o) => o.kind !== 'INHIBITOR')
    const teamTotal = objs.reduce((a, o) => a + o.team, 0)
    const mine = objs.reduce((a, o) => a + o.mine, 0)
    if (teamTotal > 0) add('objectives', (100 * mine) / teamTotal, `presente em ${mine} de ${teamTotal} objetivos do time`)
  }

  {
    const per10 = me.deaths / (minutesPlayed / 10)
    add('survival', (100 * (5 - per10)) / 4, `${me.deaths} mortes (${r1(per10)} a cada 10 min)`)
  }

  // nota geral = média ponderada dos componentes que existem nesta partida
  let wsum = 0
  let acc = 0
  for (const c of comps) {
    const wt = w[c.key]
    wsum += wt
    acc += wt * c.score
  }
  let score = wsum > 0 ? acc / wsum : 50
  // Vitória pesa pouco (o resultado depende do time), mas a nota não deveria ignorá-la.
  if (me.win) score += 3
  score = Math.round(clamp(score, 0, 100))

  const analysis: Analysis = {
    gameId: report.gameId,
    score,
    grade: gradeOf(score),
    role,
    opponentId: opp?.id ?? null,
    components: comps,
    csPerMin: r1(csPerMin),
    killParticipation: kp,
    damageShare,
    goldShare,
    visionPerMin: r1(visionPerMin),
    minutes,
    me: meSeries,
    opp: oppSeries,
    teamGoldDiff,
    diffs,
    phases: hasKillEvents ? phases : [],
    objectives,
    swings,
    insights: []
  }
  analysis.insights = buildInsights(report, me, opp, enemies, analysis)
  return analysis
}

function findSwings(report: MatchReport, me: PgParticipant, minutes: number[], diff: number[]): Swing[] {
  if (diff.length < 4) return []
  const cand: { minute: number; delta: number }[] = []
  for (let i = 2; i < diff.length; i++) cand.push({ minute: minutes[i], delta: diff[i] - diff[i - 2] })
  cand.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const picked: { minute: number; delta: number }[] = []
  for (const c of cand) {
    if (Math.abs(c.delta) < 900) break
    if (picked.some((p) => Math.abs(p.minute - c.minute) < 3)) continue
    picked.push(c)
    if (picked.length === 3) break
  }
  return picked
    .sort((a, b) => a.minute - b.minute)
    .map((p) => {
      const evs = report.events.filter((e) => e.t >= (p.minute - 2) * 60 && e.t < p.minute * 60)
      const bits: string[] = []
      const deaths = evs.filter((e) => e.kind === 'KILL' && e.victimId === me.id).length
      if (deaths) bits.push(deaths === 1 ? 'você morreu' : `você morreu ${deaths}x`)
      const kills = evs.filter((e) => e.kind === 'KILL')
      const ours = kills.filter((e) => e.teamId === me.teamId).length
      const theirs = kills.length - ours
      if (kills.length) bits.push(`abates ${ours} x ${theirs}`)
      for (const e of evs) {
        const label = OBJECTIVE_LABEL[e.kind]
        if (!label || e.kind === 'KILL') continue
        bits.push(`${label.toLowerCase()} para ${e.teamId === me.teamId ? 'o seu time' : 'o inimigo'}`)
      }
      const dir = p.delta > 0 ? 'a favor do seu time' : 'a favor do inimigo'
      return {
        minute: p.minute,
        delta: Math.round(p.delta),
        text: `${Math.abs(Math.round(p.delta))} de ouro ${dir}${bits.length ? ` (${bits.join(', ')})` : ''}`
      }
    })
}

// ------------------------------------------------------------------ dicas em português

function buildInsights(report: MatchReport, me: PgParticipant, opp: PgParticipant | null, enemies: PgParticipant[], a: Analysis): Insight[] {
  const out: Insight[] = []
  const role = a.role
  const push = (level: InsightLevel, title: string, detail: string) => out.push({ level, title, detail })

  // farm
  if (role && role !== 'UTILITY') {
    const target = CS_TARGET[role]
    if (a.csPerMin >= target * 1.05) push('good', 'Farm forte', `${a.csPerMin} CS/min, acima da referência de ${target} para ${ROLE_PT[role].toLowerCase()}.`)
    else if (a.csPerMin < target * 0.8) {
      const missing = Math.round((target - a.csPerMin) * (report.durationSec / 60))
      push('bad', 'Farm abaixo do esperado', `${a.csPerMin} CS/min contra ${target} de referência: cerca de ${missing} tropas/monstros a menos no jogo todo.`)
    } else push('info', 'Farm dentro do esperado', `${a.csPerMin} CS/min (referência ${target}).`)
  }

  // rota
  const d10 = a.diffs.find((d) => d.minute === 10)
  const d15 = a.diffs.find((d) => d.minute === 15)
  if (opp && d10 && d10.cs !== null && d10.gold !== null) {
    if (d10.cs <= -10 || d10.gold <= -400) push('bad', 'Perdeu a rota no início', `Aos 10 min: CS ${signed(d10.cs)} e ouro ${signed(d10.gold)} contra o oponente.`)
    else if (d10.cs >= 8 || d10.gold >= 400) push('good', 'Começo de jogo vencido', `Aos 10 min: CS ${signed(d10.cs)} e ouro ${signed(d10.gold)} contra o oponente.`)
  }
  if (opp && d10 && d15 && d10.gold !== null && d15.gold !== null && d10.gold - d15.gold >= 500) {
    push('warn', 'Vantagem escapou entre 10 e 15 min', `A diferença de ouro caiu de ${signed(d10.gold)} para ${signed(d15.gold)}.`)
  }

  // mortes
  const early = a.phases[0]
  if (early && early.deaths >= 2) push('bad', 'Mortes demais no início', `${early.deaths} mortes antes dos 10 min. Cada uma custa ouro, XP e a pressão na rota.`)
  const perMin = me.deaths / Math.max(1, report.durationSec / 60)
  if (me.deaths >= 8 && perMin > 0.3) push('bad', 'Muitas mortes no jogo', `${me.deaths} mortes em ${Math.round(report.durationSec / 60)} min.`)
  else if (me.deaths <= 2 && report.durationSec > 900) push('good', 'Jogo limpo', `Só ${me.deaths} ${me.deaths === 1 ? 'morte' : 'mortes'} no jogo.`)
  const late = a.phases[2]
  if (late && late.deaths >= 3) push('warn', 'Mortes no final do jogo', `${late.deaths} mortes depois dos 20 min, quando cada uma dá tempo ao inimigo para pegar objetivos.`)

  // lutas
  if (a.killParticipation >= 0.65) push('good', 'Presente nas lutas', `Participação em ${pct(a.killParticipation)} dos abates do time.`)
  else if (a.killParticipation < 0.4 && report.durationSec > 900) push('warn', 'Pouca participação', `Só ${pct(a.killParticipation)} dos abates do time tiveram você.`)

  // visão
  if (role) {
    const target = VISION_TARGET[role]
    if (a.visionPerMin < target * 0.6) push('warn', 'Pouca visão', `${a.visionPerMin} de visão por minuto (referência ${target}). Mais sentinelas deixam o mapa mais seguro.`)
    else if (a.visionPerMin >= target * 1.2) push('good', 'Boa visão de mapa', `${a.visionPerMin} de visão por minuto.`)
  }

  // objetivos
  const dragons = a.objectives.find((o) => o.kind === 'DRAGON')
  if (dragons && dragons.enemy >= 3 && dragons.team <= 1) push('warn', 'Dragões cederam', `O inimigo pegou ${dragons.enemy} dragões contra ${dragons.team} do seu time.`)
  const baron = a.objectives.find((o) => o.kind === 'BARON')
  if (baron && baron.enemy > baron.team) push('warn', 'Barão para o inimigo', 'O inimigo pegou o Barão. Vale ver como foi o posicionamento antes da luta.')

  // selva
  if (role === 'JUNGLE') {
    const share = me.cs + me.jungleCs > 0 ? me.jungleCs / (me.cs + me.jungleCs) : 0
    if (share < 0.8) push('info', 'Selva com muito tempo em rota', `${pct(share)} do seu farm veio da selva; o resto, de tropas de rota.`)
    const objs = a.objectives.filter((o) => ['DRAGON', 'HERALD', 'BARON', 'GRUBS'].includes(o.kind))
    const t = objs.reduce((x, o) => x + o.team, 0)
    const m = objs.reduce((x, o) => x + o.mine, 0)
    if (t >= 2 && m / t < 0.5) push('bad', 'Pouca presença nos objetivos', `Você participou de ${m} dos ${t} objetivos neutros do seu time. Para a selva, isso decide jogos.`)
    if (t >= 2 && m / t >= 0.8) push('good', 'Selva presente nos objetivos', `Você participou de ${m} dos ${t} objetivos neutros do seu time.`)
  }

  // suporte
  if (role === 'UTILITY' && me.wardsKilled >= 10) push('good', 'Visão do inimigo destruída', `${me.wardsKilled} sentinelas inimigas removidas.`)

  // oponente de rota muito mais forte no fim
  if (opp && report.durationSec > 900) {
    const myCs = me.cs + me.jungleCs
    const oCs = opp.cs + opp.jungleCs
    if (role && role !== 'UTILITY' && myCs < oCs - 30) push('warn', 'Oponente de rota fechou mais farm', `${myCs} CS contra ${oCs} do oponente.`)
  }
  void enemies

  if (!report.hasTimeline) {
    push('info', 'Sem a linha do tempo', 'O cliente não entregou a timeline desta partida; a análise usa só o placar final. Gráficos por minuto não estão disponíveis.')
  }

  const order: Record<InsightLevel, number> = { bad: 0, warn: 1, good: 2, info: 3 }
  return out.sort((x, y) => order[x.level] - order[y.level]).slice(0, 8)
}

// ------------------------------------------------------------------ histórico e IPC

export interface PgSummary {
  gameId: number
  playedAt: number | null
  savedAt: number
  durationSec: number
  mode: string
  queueId: number
  win: boolean | null
  championId: number
  role: Role | null
  score: number
  grade: Grade
  kills: number
  deaths: number
  assists: number
  hasTimeline: boolean
}

export interface PgDetail {
  report: MatchReport
  analysis: Analysis
}

export interface PgFetchResult {
  ok: boolean
  gameId?: number
  message: string
}

export function summarize(report: MatchReport, analysis: Analysis, savedAt: number): PgSummary {
  const me = report.participants.find((p) => p.isMe)
  return {
    gameId: report.gameId,
    playedAt: report.playedAt,
    savedAt,
    durationSec: report.durationSec,
    mode: report.mode,
    queueId: report.queueId,
    win: report.win,
    championId: me?.championId ?? 0,
    role: me?.role ?? null,
    score: analysis.score,
    grade: analysis.grade,
    kills: me?.kills ?? 0,
    deaths: me?.deaths ?? 0,
    assists: me?.assists ?? 0,
    hasTimeline: report.hasTimeline
  }
}
