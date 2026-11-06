// src/shared/api.ts
// Contrato do `window.api` exposto pelo preload. Main, Preload e Renderer usam estes tipos.
import type { OverlayState } from './overlay'
import type { PoolSuggestResult } from './poolImport'
import type { BuildSelection } from './buildSelection'
import type { AccountStats, DraftState, LcuIdentity, LcuStatus, Role } from './types'
import type {
  AppSettings,
  BanSuggestion,
  MetaCounter,
  PatchChanges,
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

export type BackupExportResult = { ok: true; path: string; profiles: number } | { ok: false; reason: 'canceled' | 'error' }
export type BackupImportResult =
  | { ok: true; added: number; updated: number; skipped: number }
  | { ok: false; reason: 'canceled' | 'invalid'; message?: string }

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
  /** Estado atual do painel dentro do jogo (null = nada a mostrar). */
  getOverlayState(): Promise<OverlayState | null>
  onOverlayState(cb: (state: OverlayState | null) => void): () => void
  /** Mostra o painel com dados de exemplo por alguns segundos; false = sem dados de meta reais para mostrar. */
  previewOverlay(): Promise<boolean>
  /** Lê do cliente do LoL (só leitura) as partidas recentes e a maestria da conta logada e sugere uma Pool. */
  suggestPoolFromAccount(): Promise<PoolSuggestResult>
  /** Liga o modo mover (arrastar o painel); false = sem dados para mostrar o painel. */
  startOverlayMove(): Promise<boolean>
  /** Salva a posição atual do painel e volta ao modo normal. */
  finishOverlayMove(): Promise<void>
  /** Texto de diagnóstico (sem dados pessoais) para copiar e enviar. */
  getDiagnostics(): Promise<string>
  /** Última tentativa de aceitar a partida (null = nenhuma ainda). */
  getLastAccept(): Promise<{ ok: boolean; status: number; at: number } | null>
  /** Salva o relatório de diagnóstico em um arquivo escolhido pelo usuário. */
  saveDiagnostics(): Promise<{ ok: boolean; path?: string }>
  /** Testa os endpoints do cliente do LoL e devolve linhas prontas para mostrar. */
  probeClient(): Promise<string[]>
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
  /** Mudanças de patch nos campeões das suas Pools desde a última vez que você viu (null = nada a avisar). */
  getPatchChanges(): Promise<PatchChanges | null>
  /** Marca o patch atual como visto. */
  ackPatchChanges(): Promise<void>
  /** Ranking de campeões da rota (tela Meta). */
  getMetaTiers(role: Role): Promise<MetaTierRow[]>
  /** Sugestões de banimento para o draft atual ([] fora da fase de bans ou sem dados reais). */
  getBanSuggestions(req: { profileId?: string }): Promise<BanSuggestion[]>
  /** Melhores picks do meta contra o inimigo da sua rota, fora da sua Pool. */
  getMetaCounters(req: { profileId?: string }): Promise<MetaCounter[]>
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
  /** Salva todos os perfis em um arquivo de backup. */
  exportBackup(): Promise<BackupExportResult>
  /** Restaura perfis de um arquivo de backup (mesmo id substitui, novos são adicionados). */
  importBackup(): Promise<BackupImportResult>
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
