// src/shared/api.ts
// Contrato do `window.api` exposto pelo preload. Main, Preload e Renderer usam estes tipos.
import type { BuildSelection } from './buildSelection'
import type { AccountStats, DraftState, LcuIdentity, LcuStatus, Role } from './types'
import type {
  AppSettings,
  BanSuggestion,
  BuildSituation,
  Catalog,
  ChampionBuild,
  FriendProfile,
  MetaChampionDetail,
  MetaInfo,
  MetaTierRow,
  Recommendation,
  SpellInfo,
  UpdateState
} from './dataTypes'
import type { PgDetail, PgFetchResult, PgSummary } from './postgame'
import type { LoadoutParts, LoadoutResult } from './loadout'
import type { DecodeResult, ShareOptions, SharedProfile } from './poolShare'

export type Unsubscribe = () => void

/** `id` ausente = perfil novo. O main sanitiza tudo, o renderer não é confiável. */
export type ProfileInput = Partial<FriendProfile> & { nickname: string }

export type PickDirResult = { ok: true; path: string } | { ok: false; reason: 'canceled' | 'not-lol' }

export type ImportMetaResult =
  | { ok: true; info: MetaInfo }
  | { ok: false; reason: 'canceled' | 'invalid'; message?: string }

export type UpdateMetaResult =
  | { ok: true; changed: boolean; info: MetaInfo }
  | { ok: false; reason: 'no-url' | 'network' | 'invalid'; message?: string }

export type ExportShareFileResult = { ok: true; path: string } | { ok: false; reason: 'canceled' | 'error' }

export type ImportShareFileResult =
  | { ok: true; shared: SharedProfile }
  | { ok: false; reason: 'canceled' | 'invalid'; message?: string }

/** Quem está logado no cliente e a qual perfil essa conta pertence (se algum). */
export interface IdentityState {
  account: LcuIdentity | null
  profileId: string | null
}

export type LoadoutImportResult =
  | { ok: true; parts: LoadoutResult }
  | { ok: false; message: string }

export interface LolApi {
  // Main → Renderer
  onMetaUpdated(cb: (info: MetaInfo) => void): Unsubscribe
  onLcuStatus(cb: (status: LcuStatus) => void): Unsubscribe
  onDraftUpdate(cb: (draft: DraftState) => void): Unsubscribe
  onDraftEnded(cb: () => void): Unsubscribe

  /** O app descobriu a conta logada ou reconheceu um perfil. */
  onIdentity(cb: (state: IdentityState) => void): Unsubscribe
  onUpdateState(cb: (state: UpdateState) => void): Unsubscribe
  /** O app aceitou uma partida encontrada sozinho (opção "Aceitar partida automaticamente"). */
  onAutoAccepted(cb: () => void): Unsubscribe
  /** Uma partida terminou e foi analisada. */
  onPostGameReady(cb: (summary: PgSummary) => void): Unsubscribe

  // Renderer → Main
  /** Texto de diagnóstico (sem dados pessoais) para copiar e enviar. */
  getDiagnostics(): Promise<string>
  /** Última tentativa de aceitar a partida (null = nenhuma ainda). */
  getLastAccept(): Promise<{ ok: boolean; status: number; at: number } | null>
  listPostGames(): Promise<PgSummary[]>
  getPostGame(gameId: number): Promise<PgDetail | null>
  deletePostGame(gameId: number): Promise<boolean>
  /** Busca no cliente a última partida do histórico e analisa. */
  fetchLatestPostGame(): Promise<PgFetchResult>

  getLcuStatus(): Promise<LcuStatus>
  getCurrentDraft(): Promise<DraftState | null>
  recommend(req: { profileId: string; role: Role | null; cellId?: number }): Promise<Recommendation | null>
  /** Coloca runas, feitiços e/ou itens da build no cliente (só quando o usuário clica em Importar). */
  applyLoadout(req: { championId: number; role: Role; parts: LoadoutParts; selection?: BuildSelection }): Promise<LoadoutImportResult>
  getIdentity(): Promise<IdentityState>
  /** Nível e elo da conta logada; null se o cliente não está aberto. */
  getAccountStats(): Promise<AccountStats | null>
  /** "Esta conta é este perfil": grava Riot ID e puuid no perfil. */
  claimProfile(profileId: string): Promise<IdentityState>

  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  pickGameDir(): Promise<PickDirResult>

  listProfiles(): Promise<FriendProfile[]>
  saveProfile(profile: ProfileInput): Promise<FriendProfile>
  deleteProfile(id: string): Promise<boolean>

  getCatalog(): Promise<Catalog>
  getSpells(championKey: string): Promise<SpellInfo[]>

  getMetaInfo(): Promise<MetaInfo | null>
  /** Ranking de campeões da rota (tela Meta). */
  getMetaTiers(role: Role): Promise<MetaTierRow[]>
  /** Sugestões de banimento para o draft atual ([] fora da fase de bans ou sem dados reais). */
  getBanSuggestions(req: { profileId?: string }): Promise<BanSuggestion[]>
  getMetaDetail(req: { championId: number; role: Role }): Promise<MetaChampionDetail | null>
  getBuild(req: { championId: number; role: Role }): Promise<ChampionBuild | null>
  /** Ajustes da build para o time inimigo atual; null fora do draft. */
  getBuildSituation(req: { championId: number; role: Role }): Promise<BuildSituation | null>
  importMeta(): Promise<ImportMetaResult>
  /** Baixa o meta do endereço configurado (ou do padrão do instalador). */
  updateMeta(): Promise<UpdateMetaResult>

  /** Compartilhar Pool: código de texto ("PGG1:...") ou arquivo. Aceita um perfil ainda não salvo. */
  encodeShare(profile: ProfileInput, opts: ShareOptions): Promise<string>
  decodeShare(text: string): Promise<DecodeResult>
  exportShareFile(profile: ProfileInput, opts: ShareOptions): Promise<ExportShareFileResult>
  importShareFile(): Promise<ImportShareFileResult>
  copyText(text: string): Promise<void>
  readClipboardText(): Promise<string>

  /** Atualização do próprio app (versão nova no GitHub). */
  getUpdateState(): Promise<UpdateState>
  checkForUpdates(): Promise<UpdateState>
  downloadUpdate(): Promise<UpdateState>
  /** Fecha o app, instala a versão baixada e abre de novo. */
  installUpdate(): Promise<boolean>
}
