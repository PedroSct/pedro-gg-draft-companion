// src/shared/championMeta.ts
// Rotas típicas e estilo de jogo de cada campeão, usados pelos filtros da Pool.
//
// O Data Dragon não informa em que rota um campeão costuma jogar, então esta tabela é curada à mão
// (rotas mais comuns no patch atual) e é só um atalho para filtrar: o usuário sempre pode escolher
// "Todos" e adicionar qualquer campeão em qualquer rota. Campeão que não está na tabela (lançamento
// novo) aparece em todas as rotas, para nunca ficar escondido.
import type { Role } from './types'
import { ROLES } from './dataTypes'

export type Style =
  | 'ENCHANTER'
  | 'CATCHER'
  | 'VANGUARD'
  | 'WARDEN'
  | 'JUGGERNAUT'
  | 'DIVER'
  | 'ASSASSIN'
  | 'SKIRMISHER'
  | 'BURST'
  | 'BATTLEMAGE'
  | 'ARTILLERY'
  | 'MARKSMAN'
  | 'SPECIALIST'

export const STYLES: readonly Style[] = [
  'ENCHANTER',
  'CATCHER',
  'VANGUARD',
  'WARDEN',
  'JUGGERNAUT',
  'DIVER',
  'ASSASSIN',
  'SKIRMISHER',
  'BURST',
  'BATTLEMAGE',
  'ARTILLERY',
  'MARKSMAN',
  'SPECIALIST'
]

/** "Função": o papel do campeão no time (estilo de jogo). */
export const STYLE_LABEL: Record<Style, string> = {
  ENCHANTER: 'Encantador',
  CATCHER: 'Capturador',
  VANGUARD: 'Vanguarda',
  WARDEN: 'Guardião',
  JUGGERNAUT: 'Colosso',
  DIVER: 'Mergulhador',
  ASSASSIN: 'Assassino',
  SKIRMISHER: 'Escaramuçador',
  BURST: 'Mago explosivo',
  BATTLEMAGE: 'Mago de combate',
  ARTILLERY: 'Artilharia',
  MARKSMAN: 'Atirador',
  SPECIALIST: 'Especialista'
}

/** "Classe": as categorias oficiais do Data Dragon (campo `tags`). */
export const CLASSES = ['Fighter', 'Tank', 'Mage', 'Assassin', 'Marksman', 'Support'] as const
export type ChampionClass = (typeof CLASSES)[number]

export const CLASS_LABEL: Record<ChampionClass, string> = {
  Fighter: 'Lutador',
  Tank: 'Tanque',
  Mage: 'Mago',
  Assassin: 'Assassino',
  Marksman: 'Atirador',
  Support: 'Suporte'
}

const POS: Record<string, Role> = { T: 'TOP', J: 'JUNGLE', M: 'MIDDLE', B: 'BOTTOM', S: 'UTILITY' }
const ST: Record<string, Style> = {
  EN: 'ENCHANTER',
  CA: 'CATCHER',
  VA: 'VANGUARD',
  WA: 'WARDEN',
  JU: 'JUGGERNAUT',
  DI: 'DIVER',
  AS: 'ASSASSIN',
  SK: 'SKIRMISHER',
  BU: 'BURST',
  BA: 'BATTLEMAGE',
  AR: 'ARTILLERY',
  MA: 'MARKSMAN',
  SP: 'SPECIALIST'
}

// id do Data Dragon | rotas (T=topo J=selva M=meio B=atirador S=suporte; a primeira é a principal) | estilo
const TABLE = `
Aatrox|T|JU
Ahri|M|BU
Akali|MT|AS
Akshan|MT|AS
Alistar|S|VA
Ambessa|TJM|DI
Amumu|J|VA
Anivia|M|BA
Annie|MS|BU
Aphelios|B|MA
Ashe|BS|MA
AurelionSol|M|BA
Aurora|MT|BU
Azir|M|SP
Bard|S|CA
Belveth|J|SK
Blitzcrank|S|CA
Brand|SMJ|BU
Braum|S|WA
Briar|J|SK
Caitlyn|B|MA
Camille|T|DI
Cassiopeia|MT|BA
Chogath|TM|VA
Corki|M|AR
Darius|T|JU
Diana|JM|DI
Draven|B|MA
DrMundo|TJ|JU
Ekko|JM|AS
Elise|J|AS
Evelynn|J|AS
Ezreal|B|MA
Fiddlesticks|J|SP
Fiora|T|SK
Fizz|M|AS
Galio|MS|WA
Gangplank|TM|SP
Garen|T|JU
Gnar|T|SP
Gragas|JT|DI
Graves|J|MA
Gwen|TJ|SK
Hecarim|J|DI
Heimerdinger|TMS|SP
Hwei|MS|AR
Illaoi|T|JU
Irelia|TM|DI
Ivern|J|EN
Janna|S|EN
JarvanIV|J|DI
Jax|TJ|SK
Jayce|TM|SP
Jhin|B|MA
Jinx|B|MA
Kaisa|B|MA
Kalista|B|MA
Karma|SM|EN
Karthus|JM|BA
Kassadin|M|AS
Katarina|M|AS
Kayle|T|SP
Kayn|J|SK
Kennen|T|BU
Khazix|J|AS
Kindred|J|MA
Kled|T|DI
KogMaw|B|MA
KSante|T|WA
Leblanc|M|BU
LeeSin|J|DI
Leona|S|VA
Lillia|J|BA
Lissandra|M|BU
Lucian|BM|MA
Lulu|S|EN
Lux|SM|AR
Malphite|TS|VA
Malzahar|M|BA
Maokai|STJ|VA
MasterYi|J|SK
Mel|MS|BU
Milio|S|EN
MissFortune|BS|MA
MonkeyKing|TJ|DI
Mordekaiser|T|JU
Morgana|SM|CA
Naafiri|MJ|AS
Nami|S|EN
Nasus|T|JU
Nautilus|S|VA
Neeko|MS|BU
Nidalee|J|SP
Nilah|B|SK
Nocturne|J|AS
Nunu|J|VA
Olaf|TJ|DI
Orianna|M|SP
Ornn|T|VA
Pantheon|TS|DI
Poppy|TJ|WA
Pyke|S|AS
Qiyana|MJ|AS
Quinn|T|SK
Rakan|S|CA
Rammus|J|WA
RekSai|J|DI
Rell|S|VA
Renata|S|EN
Renekton|T|DI
Rengar|JT|AS
Riven|T|SK
Rumble|TM|BA
Ryze|MT|BA
Samira|B|MA
Sejuani|J|VA
Senna|SB|MA
Seraphine|SB|EN
Sett|TS|JU
Shaco|JS|AS
Shen|TS|WA
Shyvana|J|JU
Singed|T|SP
Sion|T|VA
Sivir|B|MA
Skarner|J|VA
Smolder|BM|MA
Sona|S|EN
Soraka|S|EN
Swain|SM|BA
Sylas|MJ|BA
Syndra|M|BU
TahmKench|ST|WA
Taliyah|JM|BU
Talon|MJ|AS
Taric|S|WA
Teemo|T|SP
Thresh|S|CA
Tristana|BM|MA
Trundle|JT|JU
Tryndamere|T|SK
TwistedFate|M|SP
Twitch|BJ|MA
Udyr|JT|JU
Urgot|T|JU
Varus|BM|MA
Vayne|BT|MA
Veigar|M|BU
Velkoz|SM|AR
Vex|M|BU
Vi|J|DI
Viego|J|SK
Viktor|M|BA
Vladimir|MT|BA
Volibear|JT|JU
Warwick|J|DI
Xayah|B|MA
Xerath|SM|AR
XinZhao|J|DI
Yasuo|MTB|SK
Yone|MT|SK
Yorick|T|JU
Yunara|B|MA
Yuumi|S|EN
Zac|J|VA
Zed|MJ|AS
Zeri|B|MA
Ziggs|BM|AR
Zilean|SM|SP
Zoe|MS|BU
Zyra|S|BU
`

export interface ChampionTraits {
  positions: Role[]
  style: Style
}

export const CHAMPION_TRAITS: Readonly<Record<string, ChampionTraits>> = Object.fromEntries(
  TABLE.trim()
    .split('\n')
    .map((line) => {
      const [key, pos, st] = line.split('|')
      return [key, { positions: [...pos].map((c) => POS[c]), style: ST[st] }] as const
    })
)

// ---------------------------------------------------------------------------------- filtros

export interface FilterableChampion {
  id: number
  key: string
  name: string
  tags: string[]
}

export type LaneScope = 'lane' | 'all'

export interface ChampionFilter {
  /** "lane" = só quem joga na rota em edição; "all" = todos os campeões */
  scope: LaneScope
  /** rota em edição (usada quando scope = "lane") */
  role: Role
  /** com scope = "all": mostra só quem joga em alguma destas rotas (vazio = sem filtro) */
  lanes: Role[]
  /** classes do Data Dragon (vazio = sem filtro); basta ter uma das marcadas */
  classes: string[]
  /** estilos de jogo (vazio = sem filtro) */
  styles: Style[]
  /** texto da busca (já normalizado pelo chamador) */
  query: string
}

export const defaultFilter = (role: Role): ChampionFilter => ({
  scope: 'lane',
  role,
  lanes: [],
  classes: [],
  styles: [],
  query: ''
})

/** Rotas do campeão; null = não sabemos (campeão novo): nunca é escondido por rota. */
export function positionsOf(key: string): Role[] | null {
  return CHAMPION_TRAITS[key]?.positions ?? null
}

export const styleOf = (key: string): Style | null => CHAMPION_TRAITS[key]?.style ?? null

/** "Pode jogar na rota?" para o filtro. Sem dados = sim. */
export function playsRole(key: string, role: Role): boolean {
  const p = positionsOf(key)
  return p === null || p.includes(role)
}

export function filterChampions<T extends FilterableChampion>(
  champions: readonly T[],
  f: ChampionFilter,
  matchesQuery: (c: T, q: string) => boolean
): T[] {
  const lanes: readonly Role[] = f.scope === 'lane' ? [f.role] : f.lanes
  return champions.filter((c) => {
    if (lanes.length > 0) {
      const p = positionsOf(c.key)
      if (p !== null && !lanes.some((r) => p.includes(r))) return false
    }
    if (f.classes.length > 0 && !f.classes.some((cl) => c.tags.includes(cl))) return false
    if (f.styles.length > 0) {
      const s = styleOf(c.key)
      if (s === null || !f.styles.includes(s)) return false
    }
    return f.query ? matchesQuery(c, f.query) : true
  })
}

/** Quantos campeões cada rota tem na tabela (usado nos testes de sanidade e na tela). */
export function countByRole(): Record<Role, number> {
  const out = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>
  for (const t of Object.values(CHAMPION_TRAITS)) for (const r of t.positions) out[r]++
  return out
}
