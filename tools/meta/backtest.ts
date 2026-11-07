// tools/meta/backtest.ts
// Mede se a recomendação "enxerga" quem vai ganhar. Para cada partida reservada (que NÃO entrou nas contagens do meta),
// pontua os 10 jogadores com a mesma função que o app usa (`recommend`), somando os 5 de cada time; o time de maior
// soma é o "previsto". Compara variações dos pesos com o winrate puro do campeão na rota. É uma medida de poder de
// previsão, não de "melhor pick": o conforto fica neutro (não existe nos dados) e o draft é o final.
import { recommend, type RecommendWeights } from '../../src/main/data/recommender'
import { ROLES, type FriendProfile, type MetaDataset, type Pool } from '../../src/shared/dataTypes'
import type { DraftPlayer, DraftState, Role } from '../../src/shared/types'
import type { HoldoutMatch } from './aggregate'

export interface Variant {
  name: string
  weights: RecommendWeights
}

const ZERO: RecommendWeights = { matchup: 0, baseline: 0, comfort: 0, synergy: 0, versus: 0, comp: 0 }
const w = (over: Partial<RecommendWeights>): RecommendWeights => ({ ...ZERO, ...over })

/** O que se compara. A primeira é a referência (winrate puro). */
export const VARIANTS: Variant[] = [
  { name: 'só winrate do campeão (referência)', weights: w({ baseline: 1 }) },
  { name: 'só confronto de rota', weights: w({ matchup: 1 }) },
  { name: 'só sinergia com aliados', weights: w({ synergy: 1 }) },
  { name: 'só desempenho contra o time inimigo', weights: w({ versus: 1 }) },
  { name: 'só composição (dano, frontline, CC)', weights: w({ comp: 1 }) },
  { name: 'winrate + confronto de rota', weights: w({ baseline: 1, matchup: 1 }) },
  { name: 'modo Equilibrado (pesos do app)', weights: w({ matchup: 1, baseline: 0.5, synergy: 0.6, versus: 0.5, comp: 1 }) },
  { name: 'modo Meta (pesos do app)', weights: w({ matchup: 1.2, baseline: 1, synergy: 0.8, versus: 0.8, comp: 1 }) }
]

export interface VariantResult {
  name: string
  /** partidas em que o time previsto venceu / partidas com previsão (sem empate) */
  correct: number
  total: number
  accuracy: number
  /** erro padrão da acurácia */
  se: number
  /** diferença de acurácia para a referência e seu erro padrão (pareado, mesmas partidas) */
  diff: number
  diffSe: number
}

function draftFor(match: HoldoutMatch, side: 0 | 1, idx: number): DraftState {
  const mine = side === 0 ? match.a : match.b
  const foes = side === 0 ? match.b : match.a
  const allies: DraftPlayer[] = mine.map((championId, i) => ({
    cellId: i,
    championId: i === idx ? 0 : championId, // o próprio jogador é quem estaria escolhendo
    status: i === idx ? 'none' : 'locked',
    role: ROLES[i]
  }))
  const enemies: DraftPlayer[] = foes.map((championId, i) => ({
    cellId: 5 + i,
    championId,
    status: 'locked',
    role: null // a LCU não informa a rota dos inimigos
  }))
  return { phase: 'FINALIZATION', localPlayerCellId: idx, localRole: ROLES[idx], allies, enemies, bans: { allies: [], enemies: [] } }
}

function profileOf(championId: number, role: Role): FriendProfile {
  const pool = Object.fromEntries(ROLES.map((r) => [r, []])) as unknown as Pool
  pool[role] = [{ championId, championKey: String(championId), comfort: 3 }]
  return { id: 'bt', nickname: 'bt', mainRoles: [role], pool, createdAt: '', updatedAt: '' }
}

function teamScore(dataset: MetaDataset, match: HoldoutMatch, side: 0 | 1, weights: RecommendWeights): number {
  const mine = side === 0 ? match.a : match.b
  let sum = 0
  for (let i = 0; i < 5; i++) {
    const rec = recommend({
      draft: draftFor(match, side, i),
      profile: profileOf(mine[i], ROLES[i]),
      dataset,
      role: ROLES[i],
      allowMirror: true,
      weights
    })
    sum += rec.ranking[0]?.score ?? 0
  }
  return sum
}

export function runBacktest(dataset: MetaDataset, matches: HoldoutMatch[], variants: Variant[] = VARIANTS): VariantResult[] {
  // acerto de cada variação em cada partida: 1, 0 ou null (empate de pontuação)
  const hits = variants.map((v) =>
    matches.map((m) => {
      const blue = teamScore(dataset, m, 0, v.weights)
      const red = teamScore(dataset, m, 1, v.weights)
      if (Math.abs(blue - red) < 1e-9) return null
      return (blue > red ? 0 : 1) === m.w ? 1 : 0
    })
  )
  return variants.map((v, k) => {
    const mine = hits[k]
    const valid = mine.filter((x): x is 0 | 1 => x !== null)
    const correct = valid.reduce<number>((s, x) => s + x, 0)
    const n = valid.length
    const accuracy = n ? correct / n : 0
    // pareado com a referência: só as partidas em que as duas deram previsão
    const diffs: number[] = []
    mine.forEach((x, i) => {
      const r = hits[0][i]
      if (x !== null && r !== null) diffs.push(x - r)
    })
    const mean = diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : 0
    const varc = diffs.length > 1 ? diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (diffs.length - 1) : 0
    return {
      name: v.name,
      correct,
      total: n,
      accuracy,
      se: n ? Math.sqrt((accuracy * (1 - accuracy)) / n) : 0,
      diff: mean,
      diffSe: diffs.length ? Math.sqrt(varc / diffs.length) : 0
    }
  })
}

export function formatBacktest(results: VariantResult[], matches: number, patch: string): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
  const lines = [`Patch ${patch}: ${matches} partidas reservadas para teste (nenhuma entrou nas contagens do meta).`, '']
  for (const r of results) {
    const sig = Math.abs(r.diff) > 2 * r.diffSe && r.diffSe > 0 ? (r.diff > 0 ? '  ▲ melhor' : '  ▼ pior') : ''
    lines.push(`${r.name.padEnd(42)} acerta ${pct(r.accuracy)} ±${pct(r.se)}  (vs referência ${r.diff >= 0 ? '+' : ''}${pct(r.diff)} ±${pct(r.diffSe)})${sig}`)
  }
  lines.push('', '"▲/▼" só aparece quando a diferença passa de 2 erros padrão. Acertar 50% é o mesmo que chutar.')
  return lines.join('\n')
}
