// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { adviseItems, classifyCatalog, type EnemyInput, type MeInput } from '../src/shared/itemAdvice'
import type { ItemInfo } from '../src/shared/dataTypes'

const item = (id: number, tags: string[], extra: Partial<ItemInfo> = {}): ItemInfo => ({ id, name: `Item ${id}`, iconUrl: '', goldTotal: 3000, tags, final: true, ...extra })
const items: Record<string, ItemInfo> = Object.fromEntries(
  [
    item(100, ['Damage', 'ArmorPenetration']), // penetração de armadura (AD)
    item(101, ['SpellDamage', 'MagicPenetration']), // penetração mágica (AP)
    item(102, ['Damage'], { text: 'Dano de ataque. Ferimentos Graves: reduz a cura recebida.' }), // anticura AD
    item(103, ['SpellDamage'], { text: 'Poder de habilidade. Aplica Ferimentos Graves.' }), // anticura AP
    item(6695, ['Damage', 'ArmorPenetration'], { text: 'Reduz os escudos do alvo.' }), // anti-escudo (lista + texto)
    item(105, ['Damage', 'Armor', 'Health']), // armadura para quem bate
    item(106, ['Damage', 'Health'], { text: 'Concede um escudo quando a vida fica baixa.' }), // escudo AD
    item(107, ['Damage', 'Tenacity']), // tenacidade
    item(108, ['SpellDamage', 'SpellBlock']), // RM para mago
    { id: 109, name: 'Componente', iconUrl: '', goldTotal: 900, tags: ['Damage'] } // não é item completo
  ].map((i) => [String(i.id), i])
)

const me = (over: Partial<MeInput> = {}): MeInput => ({ physical: 0.9, magic: 0.1, durability: 0.4, tags: ['Marksman'], ...over })
const foe = (key: string, over: Partial<EnemyInput> = {}): EnemyInput => ({ key, name: key, tags: [], physical: 0.5, magic: 0.5, true: 0, durability: 0.4, cc: 0.2, weight: 1, ...over })
const tank = (key: string): EnemyInput => foe(key, { tags: ['Tank'], durability: 0.8 })

describe('itens para a partida', () => {
  it('sem inimigos conhecidos não recomenda nada', () => {
    expect(adviseItems({ items, enemies: [], me: me(), own: [], core: [1, 2, 3] })).toEqual({ advice: [], needs: [] })
    expect(adviseItems({ items, enemies: [foe('A', { weight: 0 })], me: me(), own: [], core: [1, 2, 3] }).advice).toEqual([])
  })

  it('muitos tanques: penetração do tipo do campeão (armadura para AD, mágica para AP)', () => {
    const enemies = [tank('A'), tank('B'), tank('C'), foe('D'), foe('E')]
    const ad = adviseItems({ items, enemies, me: me(), own: [], core: [1, 2, 3] })
    expect(ad.advice.find((a) => a.kind === 'penetration')).toMatchObject({ itemId: 100, general: true })
    const ap = adviseItems({ items, enemies, me: me({ physical: 0.1, magic: 0.9, tags: ['Mage'] }), own: [], core: [1, 2, 3] })
    expect(ap.advice.find((a) => a.kind === 'penetration')?.itemId).toBe(101)
  })

  it('necessidade alta troca o último item principal; média só acrescenta', () => {
    const three = adviseItems({ items, enemies: [tank('A'), tank('B'), tank('C'), foe('D')], me: me(), own: [], core: [1, 2, 3] })
    expect(three.advice[0]).toMatchObject({ kind: 'penetration', replaces: 3, slot: 3 })
    const two = adviseItems({ items, enemies: [tank('A'), tank('B'), foe('C'), foe('D')], me: me(), own: [], core: [1, 2, 3] })
    expect(two.advice.find((a) => a.kind === 'penetration')?.replaces).toBeUndefined()
  })

  it('curandeiros: anticura que combina com o campeão (AD ou AP)', () => {
    const enemies = [foe('Aatrox'), foe('Ahri'), foe('Jinx')]
    expect(adviseItems({ items, enemies, me: me(), own: [], core: [1, 2, 3] }).advice.find((a) => a.kind === 'anti-heal')?.itemId).toBe(102)
    expect(adviseItems({ items, enemies, me: me({ physical: 0.1, magic: 0.9, tags: ['Mage'] }), own: [], core: [1, 2, 3] }).advice.find((a) => a.kind === 'anti-heal')?.itemId).toBe(103)
    // um curandeiro leve sozinho não pede
    expect(adviseItems({ items, enemies: [foe('Sona'), foe('Jinx')], me: me(), own: [], core: [1, 2, 3] }).advice.find((a) => a.kind === 'anti-heal')).toBeUndefined()
  })

  it('escudos no time inimigo: item que corta escudo', () => {
    const r = adviseItems({ items, enemies: [foe('Janna'), foe('Lulu'), foe('Jinx')], me: me(), own: [], core: [1, 2, 3] })
    expect(r.advice.find((a) => a.kind === 'anti-shield')).toMatchObject({ itemId: 6695 })
    expect(r.advice.find((a) => a.kind === 'anti-shield')?.why).toMatch(/Janna, Lulu/)
  })

  it('campeão frágil contra explosão: item com escudo; tanque não precisa', () => {
    const enemies = [foe('Zed', { tags: ['Assassin'] }), foe('Talon', { tags: ['Assassin'] }), foe('Jinx')]
    expect(adviseItems({ items, enemies, me: me(), own: [], core: [1, 2, 3] }).advice.find((a) => a.kind === 'shield')?.itemId).toBe(106)
    expect(adviseItems({ items, enemies, me: me({ durability: 0.8, tags: ['Tank'] }), own: [], core: [1, 2, 3] }).advice.find((a) => a.kind === 'shield')).toBeUndefined()
  })

  it('muito controle de grupo: tenacidade', () => {
    const enemies = [foe('A', { cc: 0.9 }), foe('B', { cc: 0.8 }), foe('C', { cc: 0.7 }), foe('D')]
    expect(adviseItems({ items, enemies, me: me(), own: [], core: [1, 2, 3] }).advice.find((a) => a.kind === 'tenacity')?.itemId).toBe(107)
  })

  it('dano quase todo físico: armadura que combina (AD leva item com dano)', () => {
    const r = adviseItems({ items, enemies: [foe('A', { physical: 0.9, magic: 0.1 }), foe('B', { physical: 0.9, magic: 0.1 })], me: me(), own: [], core: [1, 2, 3] })
    expect(r.advice.find((a) => a.kind === 'armor')?.itemId).toBe(105)
    expect(r.needs[0]).toMatchObject({ kind: 'armor' })
  })

  it('prefere o item que o próprio campeão já compra, sem marcar como geral', () => {
    const extra = { ...items, '110': item(110, ['Damage', 'Armor']) }
    const r = adviseItems({ items: extra, enemies: [foe('A', { physical: 0.9, magic: 0.1 }), foe('B', { physical: 0.9, magic: 0.1 })], me: me(), own: [110], core: [1, 2, 3] })
    expect(r.advice.find((a) => a.kind === 'armor')).toMatchObject({ itemId: 110, general: false })
  })

  it('se a build principal já resolve, não sugere troca', () => {
    const r = adviseItems({ items, enemies: [tank('A'), tank('B'), tank('C')], me: me(), own: [], core: [100, 2, 3] })
    expect(r.advice.find((a) => a.kind === 'penetration')).toBeUndefined()
  })

  it('tanque não pede penetração', () => {
    const r = adviseItems({ items, enemies: [tank('A'), tank('B'), tank('C')], me: me({ durability: 0.8, tags: ['Tank'], physical: 0.5, magic: 0.5 }), own: [], core: [1, 2, 3] })
    expect(r.needs.find((n) => n.kind === 'penetration')).toBeUndefined()
  })

  it('o diagnóstico conta quantos itens cada categoria reconhece', () => {
    const c = classifyCatalog(items)
    expect(c.finals).toBe(9)
    expect(c.antiHeal).toBe(2)
    expect(c.antiShield).toBe(1)
    expect(c.shield).toBe(1)
    expect(c.tenacity).toBe(1)
  })

  it('itens que não aparecem nas builds da Rift (Arena e outros modos) nunca são sugeridos', () => {
    const arena = item(443000, ['Damage', 'ArmorPenetration']) // melhor que o 100 no papel, mas só existe em outro modo
    const withArena: Record<string, ItemInfo> = { ...items, '443000': { ...arena, goldTotal: 3600 } }
    const enemies = [tank('A'), tank('B'), tank('C'), foe('D'), foe('E')]
    const riftIds = new Set<number>(Array.from({ length: 60 }, (_, i) => i + 1).concat([100, 101, 102, 103, 105, 106, 107, 108]))
    const r = adviseItems({ items: withArena, enemies, me: me(), own: [], core: [1, 2, 3], rift: riftIds })
    expect(r.advice.map((a) => a.itemId)).not.toContain(443000)
    expect(r.advice.find((a) => a.kind === 'penetration')?.itemId).toBe(100)
    // meta pequeno (menos de 40 itens conhecidos): o filtro não vale e nada some por engano
    const few = adviseItems({ items: withArena, enemies, me: me(), own: [], core: [1, 2, 3], rift: new Set([100]) })
    expect(few.advice.find((a) => a.kind === 'penetration')).toBeDefined()
  })
})
