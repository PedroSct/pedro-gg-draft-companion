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
  /** Como ordenar as sugestões: equilibrado, mais conforto ou mais meta. */
  pickMode: RecommendMode
  /** Aceita a partida encontrada sozinho (pelo cliente do LoL). Desligado por padrão. */
  autoAccept: boolean
  /** Segundos de espera antes de aceitar (0 a 8). */
  autoAcceptDelay: number
  /** Animação de abertura do app. */
  introAnimation: boolean
  /** Menos movimento: desliga animações e transições. */
  reduceMotion: boolean
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

export interface ChampionBuild {
  /** runas mais usadas nas vitórias (ausente em dados antigos) */
  runes?: RunePage
  /** feitiços de invocador mais usados nas vitórias */
  spells?: [number, number]
  skillOrder: {
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
  build?: ChampionBuild
}

export interface MetaDataset {
  schemaVersion: 1
  source: string
  isSample?: boolean
  patch: string
  generatedAt: string
  /** chave = championId (string) */
  champions: Record<string, { roles: Partial<Record<Role, RoleMeta>> }>
}

export interface MetaInfo {
  source: string
  patch: string
  generatedAt: string
  isSample: boolean
  champions: number
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
  factors: { matchup: number; baseline: number; comfort: number; synergy: number }
}

export interface Recommendation {
  role: Role | null
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
  /** participação do campeão nas partidas da rota (0..1) */
  presence: number
  tier: Tier
  hasBuild: boolean
}

export interface MetaMatchupRow {
  championId: number
  winrate: number
  games: number
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
