// src/shared/dataTypes.ts
// Tipos do Módulo 3: perfis, meta (matchups/builds), Data Dragon e recomendação.
import type { Role } from './types'

export const ROLES: readonly Role[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

// ---------------------------------------------------------------- Perfis

export interface PoolEntry {
  championId: number
  /** id do Data Dragon, ex.: "Ahri", "MonkeyKing" (usado para ícone e habilidades) */
  championKey: string
  /** 1 (inseguro) … 5 (main) */
  comfort: number
  notes?: string
}

export type Pool = Record<Role, PoolEntry[]>

export interface FriendProfile {
  id: string
  nickname: string
  riotId?: string
  /** aprendido sozinho quando a conta aparece na seleção (nunca é compartilhado) */
  puuid?: string
  mainRoles: Role[]
  notes?: string
  pool: Pool
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  /** Pasta de instalação do LoL (ou caminho do lockfile). null = detectar automaticamente. */
  lockfilePath: string | null
  /** "auto" = acompanha o patch do cliente; ou uma versão fixa, ex.: "16.20.1" */
  ddragonVersion: string
  locale: string
  lastActiveProfileId: string | null
  /** Endereço https do meta.json. null = usar o padrão do instalador (shared/config.ts). */
  metaUrl: string | null
  /** Baixa o meta novo sozinho ao abrir o app (só age se houver endereço). */
  metaAutoUpdate: boolean
  /** Região dos dados de meta: "global" (todas juntas) ou o código de uma região (ex.: "br1"). */
  metaRegion: string
  /** Como ordenar as sugestões: equilibrado, mais conforto ou mais meta. */
  pickMode: RecommendMode
  /** Aceita a partida encontrada sozinho (pelo cliente do LoL). Desligado por padrão. */
  autoAccept: boolean
  /** Segundos de espera antes de aceitar (0 a 8). */
  autoAcceptDelay: number
  /** O tutorial de primeira vez já foi visto (ou pulado). */
  tourDone: boolean
  /** Animação de abertura do app. */
  introAnimation: boolean
  /** Menos movimento: desliga animações e transições. */
  reduceMotion: boolean
  /** Painel dentro do jogo com a próxima habilidade e os itens da build (desligado por padrão). */
  overlayEnabled: boolean
  /** Canto da tela do painel. */
  overlayCorner: 'tl' | 'tr' | 'bl' | 'br'
  /** Opacidade do painel (0,4 a 1). */
  overlayOpacity: number
  /** Posição escolhida arrastando o painel (canto superior esquerdo, em pixels da tela); null = usa o canto. */
  overlayPos: { x: number; y: number } | null
}

export interface ProfilesFile {
  schemaVersion: 1
  settings: AppSettings
  profiles: FriendProfile[]
}

// ------------------------------------------------------------------ Meta

export type SkillKey = 'Q' | 'W' | 'E' | 'R'

export interface WinStats {
  games: number
  wins: number
}

export interface SituationalItem {
  itemId: number
  /** texto curto exibido na UI, ex.: "contra muito dano mágico" */
  when: string
}

/** Página de runas (formato do cliente): 4 da árvore principal, 2 da secundária e 3 fragmentos, nessa ordem. */
export interface RunePage {
  primaryStyleId: number
  subStyleId: number
  perkIds: number[]
}

/** Uma construção alternativa: os 3 primeiros itens completos (na ordem de compra) e a bota inicial. */
export interface BuildVariant {
  core: number[]
  boots?: number
  /** fração (0..1) das vitórias analisadas que seguiram esta construção */
  share: number
}

/** Como o campeão joga de verdade (médias reais de partidas), por rota. */
export interface ChampionProfile {
  /** fatias do dano causado a campeões; somam 1 */
  physical: number
  magic: number
  true: number
  /** dano sofrido + mitigado por minuto */
  durability: number
  /** segundos de controle de grupo aplicados por minuto */
  cc: number
}

/** Uma opção de build com a amostra que a sustenta (escolha = jogos / total; vitórias = wins / jogos). */
export interface BuildOption<T> {
  value: T
  games: number
  wins: number
}

/** As opções mais usadas de cada parte da build, contando vitórias e derrotas (como o OP.GG). */
export interface BuildOptions {
  /** partidas do campeão nesta rota: base da escolha de runas e feitiços */
  games: number
  /** partidas com timeline analisada: base de itens e habilidades */
  timeline: number
  runes?: BuildOption<RunePage>[]
  spells?: BuildOption<[number, number]>[]
  starting?: BuildOption<number[]>[]
  boots?: BuildOption<number>[]
  core?: BuildOption<number[]>[]
  skills?: BuildOption<{ priority: SkillKey[]; levels?: SkillKey[] }>[]
}

export interface ChampionBuild {
  /** opções com escolha e winrate (ausente em dados anteriores à 0.5.2) */
  options?: BuildOptions
  /** construções alternativas mais usadas nas vitórias (a principal vem em `items`) */
  variants?: BuildVariant[]
  /** runas mais usadas nas vitórias (ausente em dados antigos) */
  runes?: RunePage
  /** feitiços de invocador mais usados nas vitórias */
  spells?: [number, number]
  /** ausente quando a timeline dos jogadores não permitiu ler a ordem das habilidades */
  skillOrder?: {
    /** prioridade de evolução, ex.: ['R','Q','E','W'] */
    priority: SkillKey[]
    /** opcional: 18 níveis, um por nível de campeão */
    levels?: SkillKey[]
  }
  items: {
    starting: number[]
    boots: number[]
    core: number[]
    situational: SituationalItem[]
  }
}

export interface RoleMeta extends WinStats {
  /** chave = championId do oponente na MESMA rota */
  matchups: Record<string, WinStats>
  /** chave = championId de um aliado (em qualquer rota): partidas em que os dois jogaram no mesmo time */
  synergies?: Record<string, WinStats>
  /** chave = campeão do time inimigo (em qualquer rota): partidas em que enfrentaram este campeão */
  versus?: Record<string, WinStats>
  /** dano, tanque e CC reais do campeão nesta rota */
  profile?: ChampionProfile
  build?: ChampionBuild
}

export interface MetaDataset {
  schemaVersion: 1
  source: string
  isSample?: boolean
  patch: string
  generatedAt: string
  /** servidores que entraram nas estatísticas (ex.: ['br1','kr']) */
  regions?: string[]
  /** chave = championId (string) */
  champions: Record<string, { roles: Partial<Record<Role, RoleMeta>> }>
}

export interface MetaInfo {
  source: string
  patch: string
  generatedAt: string
  isSample: boolean
  champions: number
  /** servidores que entraram nas estatísticas (ex.: ['br1','euw1']) */
  regions?: string[]
}

// ------------------------------------------------------------ Data Dragon

export interface ChampionInfo {
  id: number
  key: string
  name: string
  iconUrl: string
  tags: string[]
  /** notas do Data Dragon (0..10); ausentes em caches antigos */
  info?: { attack: number; defense: number; magic: number; difficulty: number }
}

export interface ItemInfo {
  id: number
  name: string
  iconUrl: string
  goldTotal: number
  /** categorias do Data Dragon (ex.: 'Armor', 'SpellBlock', 'ArmorPenetration'); ausente em caches antigos */
  tags?: string[]
}

export interface SpellInfo {
  slot: SkillKey | 'P'
  name: string
  description: string
  iconUrl: string
}

export interface Catalog {
  version: string
  locale: string
  champions: ChampionInfo[]
  items: Record<string, ItemInfo>
  /** árvores e runas (por id): nome e ícone. Ausente se o Data Dragon não entregou. */
  runes?: Record<string, NamedIcon>
  /** feitiços de invocador (por id numérico): nome e ícone */
  summoners?: Record<string, NamedIcon>
}

export interface NamedIcon {
  name: string
  iconUrl: string
}

// ------------------------------------------------------------ Recomendação

export type ExclusionReason = 'banned' | 'picked-ally' | 'picked-enemy'
export type Confidence = 'high' | 'medium' | 'low'

export interface MatchupFactor {
  vsChampionId: number
  /** winrate suavizado (0..1) do campeão da Pool contra esse oponente */
  winrate: number
  games: number
}

export interface SynergyFactor {
  withChampionId: number
  /** quanto o winrate (suavizado) sobe ou desce quando este aliado está no time, em pontos percentuais */
  delta: number
  games: number
}

export type RiskLevel = 'none' | 'low' | 'medium' | 'high'

/** Estilo do Draftforge: counters que o inimigo ainda pode escolher. */
export interface PickRisk {
  level: RiskLevel
  /** counters ainda disponíveis para o inimigo, do pior para o menos pior; winrate = do SEU campeão */
  counters: MatchupFactor[]
}

/** Quanto peso dar ao meta (dados) e ao conforto na hora de ordenar. */
export type RecommendMode = 'balanced' | 'comfort' | 'meta'

export interface PickScore {
  championId: number
  championKey: string
  role: Role
  score: number
  comfort: number
  confidence: Confidence
  baselineWinrate: number | null
  matchupWinrate: number | null
  /** fração (0..1) dos oponentes prováveis da rota que têm dados de matchup */
  matchupCoverage: number
  matchups: MatchupFactor[]
  /** sinergia média com os aliados já escolhidos (pontos percentuais); null = sem dados */
  synergyDelta: number | null
  synergies: SynergyFactor[]
  risk: PickRisk
  /** contribuição de cada fator no score, em pontos */
  factors: { matchup: number; baseline: number; comfort: number; synergy: number; versus: number; comp: number }
  /** desempenho médio contra os campeões inimigos (fora da rota), em pontos percentuais; null = sem dados */
  versusDelta: number | null
  versusList: SynergyFactor[]
  /** o que este pick muda na composição do time */
  compReasons: CompReason[]
}

/** Motivos de composição (o texto fica na interface). */
export type CompReason =
  | 'adds-magic'
  | 'adds-physical'
  | 'too-much-physical'
  | 'too-much-magic'
  | 'adds-frontline'
  | 'frontline-surplus'
  | 'adds-cc'

/** Ajustes de build para a partida atual (time inimigo e aliado). */
export interface BuildSituation {
  /** inimigos já conhecidos (escolhidos ou em hover) */
  enemiesKnown: number
  /** fatias do dano do time inimigo; null se não há inimigos conhecidos */
  enemyDamage: { physical: number; magic: number } | null
  /** inimigos com muito tanque */
  tankyEnemies: number
  focus: 'armor' | 'magic-resist' | 'penetration' | null
  /** itens do próprio campeão (situacionais e variantes) que atendem ao foco */
  picks: { itemId: number; reason: 'armor' | 'magic-resist' | 'penetration' }[]
  /** os 3 itens da construção alternativa que melhor encaixa; null = a principal */
  variantCore: number[] | null
}

export type BanReason =
  | {
      kind: 'counter'
      /** o campeão seu ou de um amigo que ele atrapalha */
      championId: number
      nickname: string
      role: Role
      /** vitórias do campeão sugerido contra aquele (na rota) */
      winrate: number
      games: number
    }
  | { kind: 'meta'; role: Role; tier: Tier; winrate: number; games: number }

export interface BanSuggestion {
  championId: number
  score: number
  reasons: BanReason[]
}

/** O que mudou para um campeão da sua Pool entre dois patches. */
export interface PatchChange {
  championId: number
  role: Role
  fromTier: Tier
  toTier: Tier
  winrateFrom: number
  winrateTo: number
  /** primeiro item do núcleo da build mudou (ids de item) */
  coreFrom?: number
  coreTo?: number
}

export interface PatchChanges {
  fromPatch: string
  toPatch: string
  changes: PatchChange[]
}

/** Pick do meta (fora da sua Pool) que vence bem o inimigo da sua rota. */
export interface MetaCounter {
  championId: number
  enemyId: number
  role: Role
  /** winrate do campeão sugerido contra o inimigo (0..1) */
  winrate: number
  games: number
  /** winrate suavizado, usado só para ordenar */
  score: number
}

export interface Recommendation {
  role: Role | null
  /** a rota veio de um palpite (Pool + rotas dos aliados), não da fila nem de uma escolha sua */
  roleGuessed?: boolean
  confidence: Confidence | 'none'
  ranking: PickScore[]
  excluded: { championId: number; reason: ExclusionReason }[]
  note?: 'empty-pool' | 'all-unavailable' | 'no-meta-data'
}

// ------------------------------------------------------------ Atualização do app

export type UpdateStatus =
  | 'unsupported' // versão de desenvolvimento ou sem repositório configurado
  | 'idle'
  | 'checking'
  | 'available' // há versão nova, ainda não baixada (o app pede permissão)
  | 'downloading'
  | 'ready' // baixada: falta reiniciar para instalar
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** versão instalada agora */
  current: string
  /** versão nova encontrada */
  latest?: string
  /** novidades da versão (texto simples) */
  notes?: string
  /** 0..100, enquanto baixa */
  percent?: number
  message?: string
  /** ISO da última verificação concluída */
  checkedAt?: string
}

// ------------------------------------------------------------ Tela "Meta"

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D'

export interface MetaTierRow {
  championId: number
  games: number
  /** winrate bruto (0..1) */
  winrate: number
  /** diferença para 50% em pontos, já com suavização (poucos jogos puxam para 0) */
  delta: number
  /** pontuação do ranking: igual a delta, mas dentro da faixa B quando há poucos jogos */
  score: number
  /** participação do campeão nas partidas da rota (0..1) */
  presence: number
  tier: Tier
  hasBuild: boolean
  /** poucos jogos: o tier fica em B e os números ainda oscilam */
  lowSample: boolean
}

export interface MetaMatchupRow {
  championId: number
  winrate: number
  games: number
  /** vem do desempenho contra o campeão em qualquer rota (não só na rota) */
  anyLane?: boolean
}

export interface MetaChampionDetail {
  championId: number
  role: Role
  games: number
  winrate: number
  delta: number
  presence: number
  tier: Tier
  /** contra quem este campeão vai melhor / pior (ao menos 8 jogos) */
  best: MetaMatchupRow[]
  worst: MetaMatchupRow[]
  /** aliados com quem ele rende mais */
  allies: { championId: number; delta: number; games: number }[]
  build: ChampionBuild | null
}
