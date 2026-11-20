// src/shared/itemAdvice.ts
// Itens para ESTA partida, olhando o time inimigo: armadura, resistência mágica, penetração, anticura, anti-escudo,
// escudo contra explosão e tenacidade. Usa o catálogo do Data Dragon (categorias e texto dos itens), então acompanha o patch.
// Função pura, sem I/O. É sugestão: o app não compra nada.
import type { ItemInfo } from './dataTypes'

export type AdviceKind = 'armor' | 'magic-resist' | 'penetration' | 'anti-heal' | 'anti-shield' | 'shield' | 'tenacity'

export interface ItemAdvice {
  itemId: number
  kind: AdviceKind
  /** por que (em português, com o que o time inimigo tem) */
  why: string
  /** true = vem do catálogo geral, não da lista de itens que o próprio campeão costuma comprar */
  general: boolean
  /** quando a necessidade é grande: o item da build principal que este substitui, e a posição dele (1 a 6) */
  replaces?: number
  slot?: number
}

export interface EnemyInput {
  /** nome do Data Dragon (ex.: "DrMundo"), para as listas de curadores e escudos */
  key: string
  name: string
  tags: readonly string[]
  physical: number
  magic: number
  true: number
  /** 0..1 */
  durability: number
  /** 0..1 */
  cc: number
  /** 1 = confirmado, 0,5 = só marcado */
  weight: number
}

export interface MeInput {
  physical: number
  magic: number
  /** 0..1 */
  durability: number
  tags: readonly string[]
}

export interface AdviceInput {
  items: Readonly<Record<string, ItemInfo>>
  enemies: readonly EnemyInput[]
  me: MeInput
  /** itens que o próprio campeão costuma comprar além dos principais (situacionais e opções) */
  own: readonly number[]
  /** build principal escolhida, na ordem */
  core: readonly number[]
}

export interface AdviceResult {
  advice: ItemAdvice[]
  /** o que o time inimigo pede, mesmo quando não há item para recomendar */
  needs: { kind: AdviceKind; level: 'alta' | 'média'; why: string }[]
}

/** Campeões que se curam muito (o resto dos curandeiros entra pela contagem). */
const HEAL_HEAVY = new Set(['Aatrox', 'Soraka', 'Vladimir', 'Warwick', 'DrMundo', 'Swain', 'Yuumi', 'Sylas', 'Briar', 'Olaf'])
const HEAL_SOME = new Set([
  'Sona', 'Nami', 'Seraphine', 'Fiddlesticks', 'Irelia', 'Taric', 'Volibear', 'Trundle', 'Rengar', 'Kayn', 'Ekko', 'Zac', 'Maokai', 'Kayle', 'Tryndamere', 'Samira', 'Illaoi', 'Renekton', 'Nidalee', 'Ivern', 'Lulu', 'Gwen'
])
const SHIELDERS = new Set(['Janna', 'Karma', 'Lulu', 'Orianna', 'Sivir', 'Lux', 'Shen', 'Galio', 'Diana', 'Ivern', 'Rakan', 'Seraphine', 'Taric', 'Soraka', 'Mordekaiser', 'Malphite', 'Nautilus', 'Braum', 'Zilean', 'Yuumi', 'Sett', 'Briar', 'Rell', 'Renata', 'Milio'])

/** Anticura e anti-escudo: pelo texto do item (português ou inglês) e por uma lista de itens conhecidos. */
const ANTI_HEAL_TEXT = /ferimentos? graves?|feridas? graves?|grievous wounds/i
const ANTI_SHIELD_TEXT = /(?:reduz|reduce|diminu)\w*[^.]{0,40}(?:escudos?|shields?)|shield reaver|ruptura de escudo/i
const ANTI_HEAL_IDS = new Set([3165, 3075, 3033, 6609, 3011, 3916, 3123])
const ANTI_SHIELD_IDS = new Set([6695])
const SHIELD_TEXT = /\bescudo|\bshield/i
const CLEANSE_TEXT = /purific|cleanse|remove[^.]{0,40}controle|remove[^.]{0,40}crowd control|qss/i

export const hasTag = (it: ItemInfo | undefined, t: string): boolean => !!it?.tags?.includes(t)
export const isAntiHeal = (it: ItemInfo | undefined): boolean => !!it && (ANTI_HEAL_IDS.has(it.id) || ANTI_HEAL_TEXT.test(it.text ?? ''))
export const isAntiShield = (it: ItemInfo | undefined): boolean => !!it && (ANTI_SHIELD_IDS.has(it.id) || ANTI_SHIELD_TEXT.test(it.text ?? ''))
const grantsShield = (it: ItemInfo | undefined): boolean => !!it && SHIELD_TEXT.test(it.text ?? '') && !isAntiShield(it)
const cleanses = (it: ItemInfo | undefined): boolean => !!it && (hasTag(it, 'Tenacity') || CLEANSE_TEXT.test(it.text ?? ''))

type Style = 'ad' | 'ap' | 'tank' | 'mixed'
function styleOf(me: MeInput): Style {
  if (me.durability >= 0.65 && me.tags.includes('Tank')) return 'tank'
  if (me.physical >= 0.62) return 'ad'
  if (me.magic >= 0.62) return 'ap'
  return 'mixed'
}

/** O item combina com o jeito de jogar do campeão (dano físico, mágico ou tanque)? Evita Void Staff para atirador. */
function fitsStyle(it: ItemInfo, style: Style): boolean {
  const ad = hasTag(it, 'Damage') || hasTag(it, 'AttackSpeed') || hasTag(it, 'CriticalStrike') || hasTag(it, 'ArmorPenetration')
  const ap = hasTag(it, 'SpellDamage') || hasTag(it, 'MagicPenetration')
  if (style === 'ad') return ad && !ap
  if (style === 'ap') return ap && !ad
  if (style === 'tank') return hasTag(it, 'Armor') || hasTag(it, 'SpellBlock') || hasTag(it, 'Health')
  return true
}

const SATISFIES: Record<AdviceKind, (it: ItemInfo | undefined, style: Style) => boolean> = {
  armor: (it) => hasTag(it, 'Armor'),
  'magic-resist': (it) => hasTag(it, 'SpellBlock'),
  penetration: (it, style) => (style === 'ap' ? hasTag(it, 'MagicPenetration') : style === 'ad' ? hasTag(it, 'ArmorPenetration') : hasTag(it, 'ArmorPenetration') || hasTag(it, 'MagicPenetration')),
  'anti-heal': isAntiHeal,
  'anti-shield': isAntiShield,
  shield: grantsShield,
  tenacity: cleanses
}

/** Nome de cada necessidade, em português. */
export const KIND_LABEL: Record<AdviceKind, string> = {
  armor: 'Armadura',
  'magic-resist': 'Resistência mágica',
  penetration: 'Penetração',
  'anti-heal': 'Anticura',
  'anti-shield': 'Corta escudo',
  shield: 'Escudo contra explosão',
  tenacity: 'Tenacidade'
}

const pct = (x: number): string => `${Math.round(x * 100)}%`
const names = (list: readonly EnemyInput[]): string => list.map((e) => e.name).join(', ')

/** Itens do catálogo que podem ser recomendados (completos, do Summoner's Rift, não botas). */
const candidates = (items: Readonly<Record<string, ItemInfo>>): ItemInfo[] => Object.values(items).filter((it) => it.final && !hasTag(it, 'Boots') && !hasTag(it, 'Consumable') && !hasTag(it, 'Trinket'))

export function adviseItems(input: AdviceInput): AdviceResult {
  const { enemies, me } = input
  const style = styleOf(me)
  const known = enemies.filter((e) => e.weight > 0)
  const weight = known.reduce((s, e) => s + e.weight, 0)
  const needs: AdviceResult['needs'] = []
  if (known.length === 0 || weight < 1) return { advice: [], needs }

  // --- o que o time inimigo pede
  const phys = known.reduce((s, e) => s + e.weight * (e.physical + e.true * 0.5), 0)
  const mag = known.reduce((s, e) => s + e.weight * (e.magic + e.true * 0.5), 0)
  const dmg = phys + mag
  const physShare = dmg > 0 ? phys / dmg : 0.5
  const tanky = known.filter((e) => e.durability >= 0.6)
  const healersHeavy = known.filter((e) => HEAL_HEAVY.has(e.key))
  const healers = known.filter((e) => HEAL_HEAVY.has(e.key) || HEAL_SOME.has(e.key))
  const shielders = known.filter((e) => SHIELDERS.has(e.key))
  const burst = known.filter((e) => e.tags.includes('Assassin'))
  const ccLoad = known.reduce((s, e) => s + e.weight * e.cc, 0)

  const want: { kind: AdviceKind; level: 'alta' | 'média'; why: string }[] = []
  if (physShare >= 0.62) want.push({ kind: 'armor', level: physShare >= 0.75 ? 'alta' : 'média', why: `O time inimigo causa ${pct(physShare)} de dano físico` })
  else if (1 - physShare >= 0.62) want.push({ kind: 'magic-resist', level: 1 - physShare >= 0.75 ? 'alta' : 'média', why: `O time inimigo causa ${pct(1 - physShare)} de dano mágico` })
  if (style !== 'tank' && tanky.length >= 2) want.push({ kind: 'penetration', level: tanky.length >= 3 ? 'alta' : 'média', why: `${tanky.length} inimigos com muita vida e resistência (${names(tanky)})` })
  if (healersHeavy.length >= 1 || healers.length >= 2) want.push({ kind: 'anti-heal', level: healersHeavy.length >= 2 || healers.length >= 3 ? 'alta' : 'média', why: `Cura no time inimigo (${names(healers)})` })
  if (shielders.length >= 2) want.push({ kind: 'anti-shield', level: shielders.length >= 3 ? 'alta' : 'média', why: `Escudos no time inimigo (${names(shielders)})` })
  if (style !== 'tank' && me.durability < 0.55 && burst.length >= 2) want.push({ kind: 'shield', level: burst.length >= 3 ? 'alta' : 'média', why: `Dano explosivo no time inimigo (${names(burst)}) e seu campeão é frágil` })
  if (ccLoad >= 2.1) want.push({ kind: 'tenacity', level: ccLoad >= 2.8 ? 'alta' : 'média', why: 'Muito controle de grupo no time inimigo' })
  for (const w of want) needs.push(w)

  // --- itens para cada necessidade
  const coreItems = input.core.map((id) => input.items[String(id)])
  const pool = candidates(input.items)
  const ownSet = new Set(input.own)
  const advice: ItemAdvice[] = []
  const used = new Set<number>(input.core)

  for (const w of want) {
    // a build principal já resolve: nada a trocar
    if (coreItems.some((it) => SATISFIES[w.kind](it, style))) continue

    const fit = (it: ItemInfo): boolean => {
      if (!SATISFIES[w.kind](it, style) || used.has(it.id)) return false
      if (w.kind === 'armor') return style === 'tank' || (style === 'ad' ? hasTag(it, 'Damage') : style === 'ap' ? hasTag(it, 'SpellDamage') : true)
      if (w.kind === 'magic-resist') return style === 'tank' || (style === 'ad' ? hasTag(it, 'Damage') : style === 'ap' ? hasTag(it, 'SpellDamage') : true)
      if (w.kind === 'penetration' || w.kind === 'tenacity') return style === 'tank' ? true : fitsStyle(it, style)
      return fitsStyle(it, style)
    }
    // o que o próprio campeão já compra não precisa passar pelo filtro de estilo (ele sabe usar)
    const own = [...ownSet].map((id) => input.items[String(id)]).filter((it): it is ItemInfo => !!it && SATISFIES[w.kind](it, style) && !used.has(it.id))
    const general = pool.filter((it) => fit(it) && !ownSet.has(it.id))
    // melhor encaixe primeiro: mais categorias úteis ao estilo e depois o mais barato
    const rank = (it: ItemInfo): number => (it.tags?.length ?? 0) * 10 - it.goldTotal / 1000
    general.sort((a, b) => rank(b) - rank(a) || a.goldTotal - b.goldTotal)
    const picked: { it: ItemInfo; general: boolean }[] = [...own.slice(0, 2).map((it) => ({ it, general: false })), ...(own.length === 0 ? general.slice(0, 1).map((it) => ({ it, general: true })) : [])]
    for (const { it, general: g } of picked) {
      used.add(it.id)
      advice.push({ itemId: it.id, kind: w.kind, why: w.why, general: g })
    }
  }

  // necessidade alta sem nada na build principal: o primeiro item sugerido pode entrar no lugar do último principal
  const top = want.find((w) => w.level === 'alta' && advice.some((a) => a.kind === w.kind))
  if (top && input.core.length >= 3) {
    const first = advice.find((a) => a.kind === top.kind)
    if (first) {
      first.replaces = input.core[input.core.length - 1]
      first.slot = input.core.length
    }
  }
  return { advice: advice.slice(0, 5), needs }
}

/** Quantos itens do catálogo cada categoria reconhece (vai no diagnóstico: mostra se o texto do patch foi entendido). */
export function classifyCatalog(items: Readonly<Record<string, ItemInfo>>): Record<'finals' | 'antiHeal' | 'antiShield' | 'shield' | 'tenacity', number> {
  const fin = candidates(items)
  return {
    finals: fin.length,
    antiHeal: fin.filter(isAntiHeal).length,
    antiShield: fin.filter(isAntiShield).length,
    shield: fin.filter(grantsShield).length,
    tenacity: fin.filter(cleanses).length
  }
}
