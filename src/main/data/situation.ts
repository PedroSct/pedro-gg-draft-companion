// src/main/data/situation.ts
// Ajusta a build à partida: olha o time inimigo (dano físico/mágico, tanque) e, entre os itens que o
// próprio campeão já costuma comprar, destaca os que mais ajudam agora. Função pura, sem I/O.
import type { DraftState, Role } from '../../shared/types'
import { traitsOf } from '../../shared/traits'
import type { BuildSituation, ChampionBuild, ChampionInfo, ItemInfo, MetaDataset } from '../../shared/dataTypes'
import { adviseItems, type EnemyInput } from '../../shared/itemAdvice'

/** A partir desta fatia o dano de um tipo domina e vale priorizar a defesa correspondente. */
const DOMINANT_SHARE = 0.62
/** Inimigo "tanque": durabilidade normalizada igual ou acima disto. */
const TANKY = 0.6

const has = (item: ItemInfo | undefined, tag: string): boolean => !!item?.tags?.includes(tag)

export function buildSituation(input: {
  dataset: MetaDataset | null
  draft: DraftState
  build: ChampionBuild | null
  championId: number
  /** rota do seu campeão (melhora o perfil de dano) */
  role?: Role | null
  champions: readonly ChampionInfo[]
  items: Readonly<Record<string, ItemInfo>>
}): BuildSituation {
  const { dataset, draft, build } = input
  const champMap = new Map(input.champions.map((c) => [c.id, c]))

  let physical = 0
  let magic = 0
  let weight = 0
  let known = 0
  let tanky = 0
  for (const e of draft.enemies) {
    if (e.championId <= 0) continue
    known++
    const t = traitsOf(dataset, champMap, e.championId, (e.role as Role | null) ?? null)
    const w = e.status === 'locked' ? 1 : 0.5
    physical += w * (t.physical + t.true * 0.5)
    magic += w * (t.magic + t.true * 0.5)
    weight += w
    if (t.durability >= TANKY) tanky++
  }
  const total = physical + magic
  const enemyDamage = known > 0 && total > 0 ? { physical: physical / total, magic: magic / total } : null

  const out: BuildSituation = { enemiesKnown: known, enemyDamage, tankyEnemies: tanky, focus: null, picks: [], advice: [], needs: [], variantCore: null }
  if (!build || !enemyDamage || weight < 1) return out

  let focus: BuildSituation['focus'] = null
  if (enemyDamage.physical >= DOMINANT_SHARE) focus = 'armor'
  else if (enemyDamage.magic >= DOMINANT_SHARE) focus = 'magic-resist'
  else if (tanky >= 2) focus = 'penetration'
  out.focus = focus

  // Itens que o próprio campeão já compra (situacionais e construções alternativas), fora da build principal
  const main = new Set(build.items.core)
  const own: number[] = []
  for (const s of build.items.situational) own.push(s.itemId)
  for (const v of build.options?.core ?? []) for (const id of v.value) own.push(id)
  for (const v of build.variants ?? []) for (const id of v.core) own.push(id)
  const ownList = [...new Set(own)].filter((id) => !main.has(id))

  // Quem está do outro lado e quem é você: o time inimigo define o que comprar, o seu estilo define qual item serve
  const enemies: EnemyInput[] = []
  for (const e of draft.enemies) {
    if (e.championId <= 0) continue
    const info = champMap.get(e.championId)
    const t = traitsOf(dataset, champMap, e.championId, (e.role as Role | null) ?? null)
    enemies.push({
      key: info?.key ?? '',
      name: info?.name ?? `Campeão ${e.championId}`,
      tags: info?.tags ?? [],
      physical: t.physical,
      magic: t.magic,
      true: t.true,
      durability: t.durability,
      cc: t.cc,
      weight: e.status === 'locked' ? 1 : 0.5
    })
  }
  const mine = traitsOf(dataset, champMap, input.championId, input.role ?? null)
  const result = adviseItems({
    items: input.items,
    enemies,
    me: { physical: mine.physical, magic: mine.magic, durability: mine.durability, tags: champMap.get(input.championId)?.tags ?? [] },
    own: ownList,
    core: build.items.core
  })
  out.advice = result.advice
  out.needs = result.needs
  out.picks = result.advice.map((a) => ({ itemId: a.itemId, reason: a.kind }))

  // Construção alternativa que mais encaixa (a principal continua valendo se nenhuma ajudar mais)
  const tagsFor = (id: number): boolean => {
    const item = input.items[String(id)]
    if (focus === 'armor') return has(item, 'Armor')
    if (focus === 'magic-resist') return has(item, 'SpellBlock')
    if (focus === 'penetration') return has(item, 'ArmorPenetration') || has(item, 'MagicPenetration')
    return false
  }
  const variants: number[][] = build.options?.core?.map((c) => c.value) ?? build.variants?.map((v) => v.core) ?? []
  if (focus && variants.length > 1) {
    const score = (list: number[]): number => list.filter((id) => tagsFor(id)).length
    let best = 0
    let bestScore = score(variants[0])
    variants.forEach((v, i) => {
      const s = score(v)
      if (s > bestScore) {
        best = i
        bestScore = s
      }
    })
    if (best > 0) out.variantCore = variants[best]
  }
  return out
}
