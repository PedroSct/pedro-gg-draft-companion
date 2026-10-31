// src/shared/types.ts
// Tipos compartilhados entre Main, Preload e Renderer.
// Nada aqui contém credenciais da LCU: a senha nunca sai do processo Main.

export type Role = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY'

/**
 * searching    = nenhum lockfile encontrado / tentando conectar
 * connected    = WebSocket aberto e inscrito na Champ Select
 * disconnected = estava conectado e perdeu a conexão (cliente fechou)
 */
export type LcuStatus = 'searching' | 'connected' | 'disconnected'

export type DraftPhase =
  | 'PLANNING'
  | 'BAN_PICK'
  | 'FINALIZATION'
  | 'GAME_STARTING'
  | 'UNKNOWN'

export type PickStatus = 'none' | 'hovering' | 'locked'

export interface DraftPlayer {
  cellId: number
  /** 0 = ainda sem campeão */
  championId: number
  status: PickStatus
  /** Aliados vêm com rota em fila ranqueada; inimigos normalmente vêm null. */
  role: Role | null
  puuid?: string
  /** "Nome#TAG" quando o cliente informa (ou o app descobre pela conta) */
  name?: string
  /** preenchidos pelo app: este jogador é você / é um amigo com perfil salvo */
  isMe?: boolean
  profileId?: string
}

/** Conta logada no cliente do LoL. */
export interface LcuIdentity {
  puuid: string
  gameName: string
  tagLine: string
}

export interface DraftState {
  phase: DraftPhase
  localPlayerCellId: number
  localRole: Role | null
  allies: DraftPlayer[]
  enemies: DraftPlayer[]
  bans: { allies: number[]; enemies: number[] }
}

/** Estado do "partida encontrada" (ready check) enviado pelo cliente. */
export interface ReadyCheck {
  /** 'InProgress' enquanto a janela de aceitar está aberta */
  state: string
  /** 'None' = você ainda não respondeu; 'Accepted' | 'Declined' */
  playerResponse: string
}
