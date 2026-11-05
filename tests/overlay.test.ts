// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canLevel, computeOverlay, nextSkill, type LiveSnapshot } from '../src/shared/overlay'
import { isSummonersRift, parseLive } from '../src/main/overlay/live'
import { cornerPosition, demoState } from '../src/main/overlay/controller'
import { sanitizeSettingsPatch } from '../src/main/store/profiles'
import type { ChampionBuild, MetaDataset, SkillKey } from '../src/shared/dataTypes'

// Q W E Q Q R Q E Q E R E E W W R W W
const LEVELS = 'QWEQQRQEQERE EWWRWW'.replace(' ', '').split('') as SkillKey[]
const skill = { priority: ['R', 'Q', 'E', 'W'] as SkillKey[], levels: LEVELS }
const zero = { Q: 0, W: 0, E: 0, R: 0 }

describe('próxima habilidade', () => {
  it('segue a ordem da build nível a nível', () => {
    expect(nextSkill(skill, zero, 1)).toMatchObject({ next: 'Q', ready: true })
    expect(nextSkill(skill, { ...zero, Q: 1 }, 2)).toMatchObject({ next: 'W', ready: true })
    expect(nextSkill(skill, { Q: 3, W: 1, E: 1, R: 0 }, 6).next).toBe('R')
    expect(nextSkill(skill, { Q: 1, W: 1, E: 1, R: 0 }, 3).upcoming).toEqual(['Q', 'R', 'Q']) // depois do próximo (nível 4): níveis 5, 6 e 7
  })
  it('sem ponto para gastar, mostra a próxima mas não marca como pronto', () => {
    expect(nextSkill(skill, { Q: 1, W: 1, E: 1, R: 0 }, 3)).toMatchObject({ next: 'Q', ready: false })
  })
  it('respeita o nível mínimo do R e do restante', () => {
    expect(canLevel('R', 0, 5)).toBe(false)
    expect(canLevel('R', 0, 6)).toBe(true)
    expect(canLevel('R', 1, 10)).toBe(false)
    expect(canLevel('Q', 1, 2)).toBe(false) // o segundo ponto só no nível 3
    expect(canLevel('Q', 1, 3)).toBe(true)
    expect(canLevel('W', 5, 18)).toBe(false)
  })
  it('se o jogador fugiu da ordem, corrige pela habilidade mais atrasada', () => {
    // pegou W duas vezes cedo (a build quer Q,W,E,Q...): agora o ponto vai para o que falta
    const r = nextSkill(skill, { Q: 0, W: 2, E: 0, R: 0 }, 3)
    expect(['Q', 'E']).toContain(r.next)
    expect(r.next).not.toBe('W')
  })
  it('sem os 18 níveis usa a prioridade; sem build de habilidade devolve nada', () => {
    expect(nextSkill({ priority: ['R', 'Q', 'E', 'W'] }, zero, 1).next).toBe('Q')
    expect(nextSkill({ priority: ['R', 'Q', 'E', 'W'] }, { Q: 3, W: 1, E: 1, R: 0 }, 6).next).toBe('R')
    expect(nextSkill(undefined, zero, 1)).toEqual({ next: null, upcoming: [], ready: false })
  })
})

const build: ChampionBuild = {
  skillOrder: skill,
  items: { starting: [1056, 2003], boots: [3020], core: [6655, 4645, 3089], situational: [{ itemId: 3157, when: 'x' }, { itemId: 3102, when: 'y' }, { itemId: 3135, when: 'z' }] }
}
const live = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ gameTime: 300, level: 5, abilities: { Q: 2, W: 1, E: 1, R: 0 }, items: [], championKey: 'Ahri', championName: 'Ahri', role: 'MIDDLE', ...over })

describe('itens do overlay', () => {
  it('mostra iniciais só no começo e marca o próximo item a comprar', () => {
    const early = computeOverlay({ championId: 103, role: 'MIDDLE', build, live: live({ gameTime: 40, items: [1056] }) })
    expect(early.items.map((i) => i.label).slice(0, 2)).toEqual(['Inicial', 'Inicial'])
    expect(early.nextItemId).toBe(6655)

    const mid = computeOverlay({ championId: 103, role: 'MIDDLE', build, live: live({ items: [6655, 3020] }) })
    expect(mid.items.some((i) => i.label === 'Inicial')).toBe(false)
    expect(mid.items.find((i) => i.itemId === 6655)?.owned).toBe(true)
    expect(mid.nextItemId).toBe(4645) // ordem: item 1, botas, item 2, item 3
    expect(mid.items.filter((i) => i.label === 'Situacional')).toHaveLength(2)
  })
  it('quando tudo foi comprado, não há próximo item; poucos dados são sinalizados', () => {
    const b: ChampionBuild = { ...build, options: { games: 100, timeline: 12 } }
    const s = computeOverlay({ championId: 103, role: 'MIDDLE', build: b, live: live({ items: [6655, 3020, 4645, 3089] }) })
    expect(s.nextItemId).toBeNull()
    expect(s.lowData).toBe(true)
  })
})

const allgame = (over: Record<string, unknown> = {}): unknown => ({
  activePlayer: { riotId: 'Pedro#BR1', level: 7, abilities: { Q: { abilityLevel: 3 }, W: { abilityLevel: 1 }, E: { abilityLevel: 1 }, R: { abilityLevel: 1 }, Passive: {} } },
  allPlayers: [
    { riotId: 'Outro#BR1', championName: 'Zed', rawChampionName: 'game_character_displayname_Zed', items: [], position: 'MIDDLE' },
    { riotId: 'Pedro#BR1', championName: 'Ahri', rawChampionName: 'game_character_displayname_Ahri', position: 'MIDDLE', items: [{ itemID: 6655 }, { itemID: 3020 }, { itemID: 0 }] }
  ],
  gameData: { gameMode: 'CLASSIC', mapNumber: 11, gameTime: 612.4 },
  ...over
})

describe('leitura da partida (Live Client Data)', () => {
  it('lê só o jogador ativo: nível, habilidades, itens, campeão e rota', () => {
    expect(parseLive(allgame())).toEqual({
      gameTime: 612.4, level: 7, abilities: { Q: 3, W: 1, E: 1, R: 1 }, items: [6655, 3020],
      championKey: 'Ahri', championName: 'Ahri', role: 'MIDDLE'
    })
  })
  it('ignora ARAM e outros modos, e respostas incompletas', () => {
    expect(isSummonersRift(allgame())).toBe(true)
    expect(parseLive(allgame({ gameData: { gameMode: 'ARAM', mapNumber: 12 } }))).toBeNull()
    expect(parseLive(allgame({ activePlayer: { riotId: 'Ninguém#X', level: 1 } }))).toBeNull()
    expect(parseLive(null)).toBeNull()
    expect(parseLive({ activePlayer: 1 })).toBeNull()
  })
  it('rota vazia (normal às cegas) vira null', () => {
    const raw = allgame() as { allPlayers: { position: string }[] }
    raw.allPlayers[1].position = ''
    expect(parseLive(raw)?.role).toBeNull()
  })
})

describe('janela e configurações do overlay', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  it('cada canto fica dentro da área útil', () => {
    for (const c of ['tl', 'tr', 'bl', 'br'] as const) {
      const p = cornerPosition(c, area)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x + 300).toBeLessThanOrEqual(1920)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y + 330).toBeLessThanOrEqual(1040)
    }
    expect(cornerPosition('tl', area).x).toBeLessThan(cornerPosition('tr', area).x)
    expect(cornerPosition('tl', area).y).toBeLessThan(cornerPosition('bl', area).y)
  })
  it('valida corner, opacidade e liga/desliga', () => {
    expect(sanitizeSettingsPatch({ overlayEnabled: true, overlayCorner: 'bl', overlayOpacity: 0.73 })).toEqual({ overlayEnabled: true, overlayCorner: 'bl', overlayOpacity: 0.75 })
    expect(sanitizeSettingsPatch({ overlayOpacity: 5 }).overlayOpacity).toBe(1)
    expect(sanitizeSettingsPatch({ overlayOpacity: 0 }).overlayOpacity).toBe(0.4)
    expect(() => sanitizeSettingsPatch({ overlayCorner: 'centro' })).toThrow()
    expect(() => sanitizeSettingsPatch({ overlayEnabled: 'sim' })).toThrow()
  })
  it('a demonstração usa um campeão com build completa e nunca os dados de amostra', () => {
    const ds: MetaDataset = {
      schemaVersion: 1, source: 't', patch: '16.22', generatedAt: '',
      champions: { '103': { roles: { MIDDLE: { games: 100, wins: 50, matchups: {}, build } as never } } }
    }
    const d = demoState(ds, () => 'Ahri')
    expect(d).toMatchObject({ championId: 103, role: 'MIDDLE', demo: true, level: 9 })
    expect(d?.skill.ready).toBe(true)
    expect(demoState({ ...ds, isSample: true }, () => 'Ahri')).toBeNull()
    expect(demoState(null, () => 'x')).toBeNull()
  })
})
