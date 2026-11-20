// src/main/data/group.ts
// Modo Grupo do Draft (duo, trio, squad ou time fechado): relações entre os campeões do grupo e quem encaixa nas vagas abertas.
// Funções puras sobre o dataset; só lê e sugere.
import type { Role } from '../../shared/types'
import type { GroupAnalysis, GroupPair, GroupSlotSuggestion, MetaDataset } from '../../shared/dataTypes'
import { rolePresence, RARE_PRESENCE } from './metaStats'
import { pairRow, rowOf } from './synergies'

export interface GroupMemberInput {
  cellId: number
  role: Role
  /** 0 = ainda sem campeão */
  championId: number
  /** ainda só marcado com o mouse (pode mudar) */
  tentative?: boolean
}

const MAX_SUGGESTIONS = 5
/** Abaixo disto o candidato nem entra: o número seria só sorte. */
const MIN_CANDIDATE_GAMES = 100
const GOOD = 1
const OK = 0.3
const WEAK = -0.3

export function groupLabel(score: number): GroupAnalysis['label'] {
  if (score >= GOOD) return 'forte'
  if (score >= OK) return 'boa'
  if (score > WEAK) return 'neutra'
  return 'fraca'
}

/** Analisa o grupo: todos os pares com campeão escolhido e os melhores candidatos para cada vaga aberta. */
export function analyzeGroup(ds: MetaDataset, members: GroupMemberInput[], unavailable: number[] = []): GroupAnalysis {
  const uniq = new Map<number, GroupMemberInput>()
  for (const m of members) if (!uniq.has(m.cellId)) uniq.set(m.cellId, m)
  const list = [...uniq.values()]
  const filled = list.filter((m) => m.championId > 0)
  const open = list.filter((m) => m.championId <= 0)

  const pairs: GroupPair[] = []
  for (let i = 0; i < filled.length; i++) {
    for (let j = i + 1; j < filled.length; j++) {
      const a = filled[i]
      const b = filled[j]
      if (a.role === b.role) continue
      const row = pairRow(ds, a.championId, a.role, b.championId, b.role)
      pairs.push({ aCell: a.cellId, bCell: b.cellId, aId: a.championId, bId: b.championId, aRole: a.role, bRole: b.role, tentative: !!(a.tentative || b.tentative), row })
    }
  }
  pairs.sort((x, y) => (y.row?.score ?? -99) - (x.row?.score ?? -99) || (y.row?.games ?? 0) - (x.row?.games ?? 0))

  const scored = pairs.filter((p) => p.row)
  const score = scored.length ? scored.reduce((sum, p) => sum + (p.row?.score ?? 0), 0) / scored.length : null

  const taken = new Set<number>([...unavailable, ...filled.map((m) => m.championId)])
  const suggestions: GroupSlotSuggestion[] = []
  if (filled.length > 0) {
    for (const slot of open) {
      const mates = filled.filter((m) => m.role !== slot.role)
      if (mates.length === 0) continue
      const picks: GroupSlotSuggestion['picks'] = []
      for (const [id, c] of Object.entries(ds.champions)) {
        const cid = Number(id)
        const mine = c.roles[slot.role]
        if (!mine || mine.games < MIN_CANDIDATE_GAMES || taken.has(cid) || rolePresence(ds, cid, slot.role) < RARE_PRESENCE) continue
        const withs: GroupSlotSuggestion['picks'][number]['with'] = []
        let sum = 0
        for (const m of mates) {
          const s = mine.synergies?.[String(m.championId)]
          const row = s && s.games >= 10 ? rowOf(ds, cid, slot.role, m.championId, m.role, s, true) : null
          if (row) {
            withs.push({ championId: m.championId, winrate: row.winrate, games: row.games, synergy: row.synergy })
            sum += row.score
          }
        }
        if (withs.length === 0) continue
        // pares sem dado contam zero: quem tem dado com todo o grupo passa na frente de quem só tem com um
        picks.push({ championId: cid, score: sum / mates.length, covered: withs.length, total: mates.length, with: withs })
      }
      picks.sort((x, y) => y.score - x.score || y.covered - x.covered)
      suggestions.push({ cellId: slot.cellId, role: slot.role, picks: picks.slice(0, MAX_SUGGESTIONS) })
    }
  }

  return {
    pairs,
    suggestions,
    score,
    label: score === null ? null : groupLabel(score),
    best: scored[0] ? { aId: scored[0].aId, bId: scored[0].bId } : null,
    weakest: scored.length > 1 && (scored[scored.length - 1].row?.score ?? 0) < OK ? { aId: scored[scored.length - 1].aId, bId: scored[scored.length - 1].bId } : null
  }
}
