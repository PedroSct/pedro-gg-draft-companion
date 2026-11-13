// src/shared/coach.ts
// Aba Treino: lê o jeito de jogar da conta (partidas recentes e maestria), avisa quando a Pool está concentrada demais
// e sugere campeões parecidos com o estilo da pessoa que estão fortes no meta. Regras puras e testáveis; cada
// frase diz o número ou o motivo que a gerou. É leitura e sugestão: não altera nada sozinho.
import { ROLES, type ChampionInfo, type MetaTierRow, type Tier } from './dataTypes'
import type { AccountGame, MasteryEntry } from './poolImport'
import type { Role } from './types'

export type Concentration = 'high' | 'medium' | 'healthy'
export type PlayerLevel = 'new' | 'regular'

export interface CoachInput {
  games: AccountGame[]
  mastery: MasteryEntry[]
  champions: ChampionInfo[]
  /** ranking do meta por rota (vazio se só há dados de amostra) */
  tiers: Partial<Record<Role, MetaTierRow[]>>
  nameOf: (championId: number) => string
}

export interface CoachChampionLine {
  championId: number
  games: number
  wins: number
  /** fatia das partidas analisadas (0..1) */
  share: number
}

export interface CoachSuggestion {
  championId: number
  role: Role
  tier: Tier
  /** winrate do campeão na rota no meta (0..1) */
  winrate: number
  metaGames: number
  /** 0..10 do Data Dragon (null = desconhecida) */
  difficulty: number | null
  /** 0..1: o quanto o estilo do campeão lembra o seu */
  similarity: number
  /** campeão que você já joga e que mais se parece com este */
  similarTo: number | null
  /** classes em comum com o campeão acima (ex.: ['Mage']) */
  sharedTags: string[]
  reasons: string[]
}

export interface CoachTip {
  level: 'good' | 'warn' | 'info'
  title: string
  detail: string
  /** campeão a que a dica se refere (para mostrar o ícone) */
  championId?: number
}

export interface CoachReport {
  gamesUsed: number
  distinct: number
  top: CoachChampionLine[]
  /** campeão que concentra metade ou mais das partidas (precisa de 8+ partidas) */
  oneTrick: CoachChampionLine | null
  concentration: Concentration
  roles: { role: Role; games: number; share: number }[]
  mainRole: Role | null
  style: { label: string; tags: { tag: string; share: number }[] } | null
  level: PlayerLevel
  suggestions: CoachSuggestion[]
  tips: CoachTip[]
}

const TAG_LABEL: Record<string, string> = {
  Fighter: 'Lutador',
  Tank: 'Tanque',
  Mage: 'Mago',
  Assassin: 'Assassino',
  Marksman: 'Atirador',
  Support: 'Suporte'
}
export const tagLabel = (tag: string): string => TAG_LABEL[tag] ?? tag

const STYLE_LABEL: Record<string, string> = {
  Fighter: 'Lutador: briga de perto e aguenta dano',
  Tank: 'Tanque: abre a luta e protege o time',
  Mage: 'Mago: dano e controle à distância com habilidades',
  Assassin: 'Assassino: entra, elimina o alvo e sai',
  Marksman: 'Atirador: dano contínuo à distância',
  Support: 'Suporte: protege, cura e dá visão'
}

const pct = (n: number): string => `${Math.round(n * 100)}%`
const MIN_ONE_TRICK_GAMES = 8
const MIN_META_GAMES = 200
const FORGOTTEN_MASTERY = 40_000

type Vec = Record<string, number>
const norm = (v: Vec): number => Math.sqrt(Object.values(v).reduce((s, x) => s + x * x, 0))
function cosine(a: Vec, b: Vec): number {
  const na = norm(a)
  const nb = norm(b)
  if (na === 0 || nb === 0) return 0
  let dot = 0
  for (const k of Object.keys(a)) dot += a[k] * (b[k] ?? 0)
  return dot / (na * nb)
}
const tagVec = (c: ChampionInfo): Vec => Object.fromEntries(c.tags.map((t) => [t, 1]))
const physicalShare = (c: ChampionInfo): number => {
  const a = c.info?.attack ?? 5
  const m = c.info?.magic ?? 5
  return a + m > 0 ? a / (a + m) : 0.5
}

export type CoachResult = { ok: true; account: string | null; report: CoachReport } | { ok: false; message: string }

export function analyzeCoach(input: CoachInput): CoachReport {
  const { games, mastery, champions, tiers, nameOf } = input
  const info = new Map(champions.map((c) => [c.id, c]))
  const used = games.filter((g) => g.championId > 0)
  const total = used.length

  // ---- Concentração
  const byChamp = new Map<number, { games: number; wins: number }>()
  for (const g of used) {
    const cur = byChamp.get(g.championId) ?? { games: 0, wins: 0 }
    cur.games++
    if (g.win) cur.wins++
    byChamp.set(g.championId, cur)
  }
  const lines: CoachChampionLine[] = [...byChamp]
    .map(([championId, s]) => ({ championId, games: s.games, wins: s.wins, share: total > 0 ? s.games / total : 0 }))
    .sort((a, b) => b.games - a.games || a.championId - b.championId)
  const top = lines.slice(0, 3)
  const topShare = lines[0]?.share ?? 0
  const oneTrick = lines[0] && total >= MIN_ONE_TRICK_GAMES && topShare >= 0.5 ? lines[0] : null
  const concentration: Concentration = total === 0 ? 'healthy' : topShare >= 0.5 || lines.length <= 2 ? 'high' : topShare >= 0.35 || lines.length <= 4 ? 'medium' : 'healthy'

  // ---- Rotas
  const roleCount = new Map<Role, number>()
  for (const g of used) if (g.role) roleCount.set(g.role, (roleCount.get(g.role) ?? 0) + 1)
  const withRole = [...roleCount.values()].reduce((a, b) => a + b, 0)
  const roles = [...roleCount]
    .map(([role, n]) => ({ role, games: n, share: withRole > 0 ? n / withRole : 0 }))
    .sort((a, b) => b.games - a.games || ROLES.indexOf(a.role) - ROLES.indexOf(b.role))
  const mainRole = roles[0]?.role ?? null

  // ---- Estilo (classes dos campeões jogados, ponderadas pelas partidas)
  const tagWeight: Vec = {}
  for (const l of lines) {
    const c = info.get(l.championId)
    if (!c) continue
    for (const t of c.tags) tagWeight[t] = (tagWeight[t] ?? 0) + l.games
  }
  const tagTotal = Object.values(tagWeight).reduce((a, b) => a + b, 0)
  const styleTags = Object.entries(tagWeight)
    .map(([tag, w]) => ({ tag, share: tagTotal > 0 ? w / tagTotal : 0 }))
    .sort((a, b) => b.share - a.share)
  const style = styleTags.length ? { label: STYLE_LABEL[styleTags[0].tag] ?? tagLabel(styleTags[0].tag), tags: styleTags.slice(0, 3) } : null

  // ---- Nível (poucas partidas e pouca maestria = pessoa nova ou voltando)
  const masteryTotal = mastery.reduce((s, m) => s + m.points, 0)
  const level: PlayerLevel = total < 15 || masteryTotal < 60_000 ? 'new' : 'regular'

  // ---- Sugestões
  const playedRecently = new Set(lines.filter((l) => l.games >= 3).map((l) => l.championId))
  const suggestions = suggestChampions({ lines, mastery, info, tiers, roles, playedRecently, styleTags, level, nameOf })

  // ---- Dicas
  const tips: CoachTip[] = []
  if (total === 0) {
    tips.push({ level: 'info', title: 'Sem partidas recentes para analisar', detail: 'Jogue algumas partidas normais ou ranqueadas e volte aqui: as dicas se baseiam no seu histórico.' })
  } else if (total < 10) {
    tips.push({ level: 'info', title: `Só ${total} ${total === 1 ? 'partida analisada' : 'partidas analisadas'}`, detail: 'Com cerca de 20 partidas as dicas ficam bem mais certeiras. Até lá, use as sugestões como ponto de partida.' })
  }
  if (oneTrick) {
    const wr = oneTrick.wins / oneTrick.games
    tips.push({
      level: 'warn',
      title: `${pct(oneTrick.share)} das suas partidas foram de ${nameOf(oneTrick.championId)}`,
      detail: `Jogar sempre o mesmo campeão deixa você refém de bans e cansa. Treine 2 ou 3 campeões de estilo parecido (veja as sugestões abaixo) para trocar quando precisar, sem perder o jeito de jogar.`,
      championId: oneTrick.championId
    })
    if (oneTrick.games >= 8 && wr <= 0.4) {
      tips.push({
        level: 'warn',
        title: `Você vence só ${pct(wr)} com ${nameOf(oneTrick.championId)}`,
        detail: `Em ${oneTrick.games} partidas. Vale rever a build e as runas no Meta, ou testar um campeão parecido que esteja forte.`,
        championId: oneTrick.championId
      })
    }
  } else if (concentration === 'medium' && total >= MIN_ONE_TRICK_GAMES) {
    tips.push({ level: 'info', title: 'Sua Pool está um pouco concentrada', detail: `${pct(topShare)} das partidas em um campeão e ${lines.length} diferentes no total. Ter 2 a 3 opções confiáveis por rota já resolve.` })
  } else if (concentration === 'healthy' && total >= MIN_ONE_TRICK_GAMES) {
    tips.push({ level: 'good', title: 'Boa variedade de campeões', detail: `${lines.length} campeões diferentes nas últimas ${total} partidas e nenhum passa de ${pct(topShare)}. Isso deixa você flexível no draft.` })
  }
  const roleSpread = roles.filter((r) => r.share >= 0.15)
  if (roleSpread.length >= 3 && withRole >= 10) {
    tips.push({ level: 'info', title: `Você joga em ${roleSpread.length} rotas`, detail: 'Ter uma rota principal e uma reserva costuma render mais do que jogar em todas: a prática se acumula e o draft fica mais simples.' })
  }
  const forgotten = [...mastery]
    .filter((m) => m.points >= FORGOTTEN_MASTERY && !playedRecently.has(m.championId))
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
  for (const m of forgotten) {
    tips.push({
      level: 'good',
      title: `Você já conhece ${nameOf(m.championId)}`,
      detail: `Maestria de ${Math.round(m.points / 1000)} mil pontos e poucas partidas recentes: é uma ótima opção reserva, sem começar do zero.`,
      championId: m.championId
    })
  }

  return { gamesUsed: total, distinct: lines.length, top, oneTrick, concentration, roles, mainRole, style, level, suggestions, tips }
}

function suggestChampions(a: {
  lines: CoachChampionLine[]
  mastery: MasteryEntry[]
  info: Map<number, ChampionInfo>
  tiers: Partial<Record<Role, MetaTierRow[]>>
  roles: { role: Role; games: number; share: number }[]
  playedRecently: Set<number>
  styleTags: { tag: string; share: number }[]
  level: PlayerLevel
  nameOf: (id: number) => string
}): CoachSuggestion[] {
  const { lines, mastery, info, tiers, roles, playedRecently, styleTags, level, nameOf } = a
  if (styleTags.length === 0) return []

  // Perfil do jogador: classes e tipo de dano, ponderados pelas partidas (maestria alta sem partidas entra com peso menor)
  const profile: Vec = {}
  let phys = 0
  let weight = 0
  const add = (id: number, w: number): void => {
    const c = info.get(id)
    if (!c || w <= 0) return
    for (const t of c.tags) profile[t] = (profile[t] ?? 0) + w
    phys += physicalShare(c) * w
    weight += w
  }
  for (const l of lines) add(l.championId, l.games)
  for (const m of mastery) if (!lines.some((l) => l.championId === m.championId)) add(m.championId, Math.min(1.5, m.points / 100_000))
  if (weight === 0) return []
  const playerPhys = phys / weight
  const played = lines.filter((l) => info.has(l.championId))

  const targetRoles = roles.filter((r, i) => i === 0 || r.share >= 0.25).slice(0, 2).map((r) => r.role)
  if (targetRoles.length === 0) targetRoles.push(...ROLES)

  type Scored = CoachSuggestion & { final: number; primary: string }
  const scored: Scored[] = []
  for (const role of targetRoles) {
    for (const row of tiers[role] ?? []) {
      if (row.games < MIN_META_GAMES || row.lowSample || playedRecently.has(row.championId)) continue
      const c = info.get(row.championId)
      if (!c) continue
      const sim = 0.7 * cosine(profile, tagVec(c)) + 0.3 * (1 - Math.abs(physicalShare(c) - playerPhys))
      const strength = Math.min(1, Math.max(0, (row.delta + 1) / 4))
      const difficulty = c.info?.difficulty ?? null
      const easy = difficulty === null ? 0.5 : 1 - difficulty / 10
      const final = 0.45 * sim + 0.35 * strength + (level === 'new' ? 0.2 : 0.08) * easy

      // O campeão jogado que mais se parece com este (para explicar a sugestão)
      let similarTo: number | null = null
      let best = 0
      let shared: string[] = []
      for (const l of played.slice(0, 4)) {
        const pc = info.get(l.championId)
        if (!pc) continue
        const s = cosine(tagVec(pc), tagVec(c))
        if (s > best) {
          best = s
          similarTo = pc.id
          shared = pc.tags.filter((t) => c.tags.includes(t))
        }
      }
      const reasons: string[] = []
      if (similarTo !== null && shared.length) reasons.push(`Joga parecido com ${nameOf(similarTo)}: mesma classe (${shared.map(tagLabel).join(' e ')}).`)
      else reasons.push(`Combina com o seu estilo (${styleTags.slice(0, 2).map((t) => tagLabel(t.tag)).join(' e ')}).`)
      reasons.push(`${pct(row.winrate)} de vitórias na rota, tier ${row.tier}.`)
      if (difficulty !== null) reasons.push(difficulty <= 4 ? `Fácil de aprender (dificuldade ${difficulty}/10).` : difficulty >= 7 ? `Mais difícil de dominar (dificuldade ${difficulty}/10).` : `Dificuldade média (${difficulty}/10).`)
      scored.push({
        championId: row.championId,
        role,
        tier: row.tier,
        winrate: row.winrate,
        metaGames: row.games,
        difficulty,
        similarity: Math.round(Math.max(0, Math.min(1, sim)) * 100) / 100,
        similarTo,
        sharedTags: shared,
        reasons,
        final,
        primary: c.tags[0] ?? ''
      })
    }
  }
  scored.sort((x, y) => y.final - x.final || x.championId - y.championId)

  // No máximo 2 da mesma classe principal, para a lista não ser só variações do mesmo campeão
  const out: CoachSuggestion[] = []
  const perClass = new Map<string, number>()
  const seen = new Set<number>()
  for (const s of scored) {
    if (seen.has(s.championId)) continue
    if ((perClass.get(s.primary) ?? 0) >= 2) continue
    perClass.set(s.primary, (perClass.get(s.primary) ?? 0) + 1)
    seen.add(s.championId)
    const { final: _f, primary: _p, ...rest } = s
    void _f
    void _p
    out.push(rest)
    if (out.length >= 6) break
  }
  return out
}
