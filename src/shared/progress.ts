// src/shared/progress.ts
// Evolução do jogador a partir das partidas já analisadas (só os resumos): nota ao longo do tempo,
// desempenho por campeão e padrões de erro. Código puro; cada observação diz o número que a gerou.
import type { PgSummary } from './postgame'
import type { Role } from './types'

export interface ChampionLine {
  championId: number
  games: number
  wins: number
  winrate: number
  avgScore: number
  kda: number
}

export interface RoleLine {
  role: Role
  games: number
  winrate: number
  avgScore: number
}

export type ObservationLevel = 'good' | 'warn' | 'info'
export interface Observation {
  level: ObservationLevel
  title: string
  detail: string
}

export interface ProgressSummary {
  games: number
  wins: number
  /** partidas com resultado conhecido */
  decided: number
  winrate: number | null
  avgScore: number
  avgDeaths: number
  /** cronológico (antiga → recente), no máximo as últimas 30 */
  trend: { gameId: number; score: number; win: boolean | null }[]
  /** média das 5 últimas menos a das 5 anteriores (null = poucas partidas) */
  scoreChange: number | null
  champions: ChampionLine[]
  roles: RoleLine[]
  observations: Observation[]
}

const MIN_GAMES = 5
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const when = (g: PgSummary): number => g.playedAt ?? g.savedAt
const kdaOf = (k: number, d: number, a: number): number => (k + a) / Math.max(1, d)
const pctText = (v: number): string => `${Math.round(v * 100)}%`

export function summarizeProgress(list: readonly PgSummary[]): ProgressSummary {
  const games = [...list].sort((a, b) => when(a) - when(b))
  const decided = games.filter((g) => g.win !== null)
  const wins = decided.filter((g) => g.win === true).length

  const trend = games.slice(-30).map((g) => ({ gameId: g.gameId, score: g.score, win: g.win }))
  let scoreChange: number | null = null
  if (games.length >= 10) {
    const last = games.slice(-5).map((g) => g.score)
    const before = games.slice(-10, -5).map((g) => g.score)
    scoreChange = Math.round(avg(last) - avg(before))
  }

  const byChamp = new Map<number, PgSummary[]>()
  const byRole = new Map<Role, PgSummary[]>()
  for (const g of games) {
    byChamp.set(g.championId, [...(byChamp.get(g.championId) ?? []), g])
    if (g.role) byRole.set(g.role, [...(byRole.get(g.role) ?? []), g])
  }
  const wr = (gs: PgSummary[]): number => {
    const d = gs.filter((g) => g.win !== null)
    return d.length ? d.filter((g) => g.win).length / d.length : 0
  }
  const champions: ChampionLine[] = [...byChamp.entries()]
    .map(([championId, gs]) => ({
      championId,
      games: gs.length,
      wins: gs.filter((g) => g.win === true).length,
      winrate: wr(gs),
      avgScore: Math.round(avg(gs.map((g) => g.score))),
      kda: Math.round(kdaOf(avg(gs.map((g) => g.kills)), avg(gs.map((g) => g.deaths)), avg(gs.map((g) => g.assists))) * 10) / 10
    }))
    .sort((a, b) => b.games - a.games || b.avgScore - a.avgScore || a.championId - b.championId)
  const roles: RoleLine[] = [...byRole.entries()]
    .map(([role, gs]) => ({ role, games: gs.length, winrate: wr(gs), avgScore: Math.round(avg(gs.map((g) => g.score))) }))
    .sort((a, b) => b.games - a.games)

  const obs: Observation[] = []
  if (games.length >= MIN_GAMES) {
    const losses = decided.filter((g) => !g.win)
    const winsG = decided.filter((g) => g.win)
    // Mortes: o erro mais comum e o mais fácil de medir.
    if (losses.length >= 3 && winsG.length >= 3) {
      const dl = avg(losses.map((g) => g.deaths))
      const dw = avg(winsG.map((g) => g.deaths))
      if (dl - dw >= 2) obs.push({ level: 'warn', title: 'As derrotas vêm com mais mortes', detail: `Você morre ${dl.toFixed(1)} vezes nas derrotas e ${dw.toFixed(1)} nas vitórias. Jogar um pouco mais seguro nos picos de pressão tende a virar jogos.` })
    }
    const highDeath = decided.filter((g) => g.deaths >= 8)
    if (highDeath.length >= 3) {
      const w = highDeath.filter((g) => g.win).length / highDeath.length
      obs.push({ level: w < 0.35 ? 'warn' : 'info', title: 'Partidas com 8 mortes ou mais', detail: `${highDeath.length} partidas, com ${pctText(w)} de vitória.` })
    }
    // Duração: perder cedo costuma ser rota/farm; perder tarde, decisão de luta.
    const early = decided.filter((g) => g.durationSec < 23 * 60)
    if (early.length >= 4 && wr(early) <= 0.35) obs.push({ level: 'warn', title: 'Você perde jogos curtos', detail: `Em partidas de até 23 min, vitória em ${pctText(wr(early))} (${early.length} jogos). Vale revisar a fase de rotas.` })
    const late = decided.filter((g) => g.durationSec >= 33 * 60)
    if (late.length >= 4 && wr(late) <= 0.35) obs.push({ level: 'warn', title: 'Você perde jogos longos', detail: `Em partidas de 33 min ou mais, vitória em ${pctText(wr(late))} (${late.length} jogos). Atenção às lutas e ao Barão no fim.` })
    // Campeões fortes e fracos.
    const eligible = champions.filter((c) => c.games >= 3)
    const best = [...eligible].sort((a, b) => b.avgScore - a.avgScore)[0]
    const worst = [...eligible].sort((a, b) => a.avgScore - b.avgScore)[0]
    if (best && worst && best.championId !== worst.championId && best.avgScore - worst.avgScore >= 10) {
      obs.push({ level: 'good', title: 'Seu campeão mais afiado', detail: `Nota média ${best.avgScore} em ${best.games} partidas (${pctText(best.winrate)} de vitória).` })
      if (worst.winrate < 0.45) obs.push({ level: 'warn', title: 'Um campeão puxa a média para baixo', detail: `Nota média ${worst.avgScore} e ${pctText(worst.winrate)} de vitória em ${worst.games} partidas.` })
    }
    if (scoreChange !== null && scoreChange >= 5) obs.push({ level: 'good', title: 'Você está evoluindo', detail: `A nota das últimas 5 partidas subiu ${scoreChange} pontos em relação às 5 anteriores.` })
    if (scoreChange !== null && scoreChange <= -5) obs.push({ level: 'warn', title: 'Queda recente de desempenho', detail: `A nota das últimas 5 partidas caiu ${Math.abs(scoreChange)} pontos em relação às 5 anteriores.` })
  }

  return {
    games: games.length,
    wins,
    decided: decided.length,
    winrate: decided.length ? wins / decided.length : null,
    avgScore: Math.round(avg(games.map((g) => g.score))),
    avgDeaths: Math.round(avg(games.map((g) => g.deaths)) * 10) / 10,
    trend,
    scoreChange,
    champions,
    roles,
    observations: obs
  }
}
