// src/main/updater.ts
// Atualização do app: consulta os Releases do GitHub (electron-updater), AVISA a pessoa e só baixa
// quando ela aceitar. A instalação acontece ao reiniciar (ou ao fechar o app, se ela deixar para depois).
import { EventEmitter } from 'node:events'
import type { UpdateState } from '../shared/dataTypes'

/** O pedaço do electron-updater que usamos (facilita testar com um falso). */
export interface UpdaterLike extends EventEmitter {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  setFeedURL(options: { provider: 'github'; owner: string; repo: string }): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateServiceOptions {
  updater: UpdaterLike | null
  currentVersion: string
  /** "dono/repositório" no GitHub; vazio = atualização automática desligada */
  repo: string
  /** false em desenvolvimento: electron-updater só funciona no app instalado */
  packaged: boolean
  onState: (state: UpdateState) => void
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const NOTES_MAX = 1500

/** Notas do release chegam em HTML ou em lista; vira texto simples e curto. */
export function notesToText(notes: unknown): string | undefined {
  let raw = ''
  if (typeof notes === 'string') raw = notes
  else if (Array.isArray(notes)) {
    raw = notes
      .map((n) => (n && typeof n === 'object' && 'note' in n ? String((n as { note: unknown }).note ?? '') : ''))
      .join('\n\n')
  }
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, NOTES_MAX) : undefined
}

export class UpdateService {
  private state: UpdateState
  private readonly active: boolean
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly o: UpdateServiceOptions) {
    this.active = Boolean(o.updater) && o.packaged && REPO_RE.test(o.repo)
    this.state = this.active
      ? { status: 'idle', current: o.currentVersion }
      : {
          status: 'unsupported',
          current: o.currentVersion,
          message: !o.packaged
            ? 'Atualizações só funcionam no app instalado.'
            : 'Este instalador não tem um repositório de atualizações configurado.'
        }
    if (this.active) this.wire()
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  private set(patch: Partial<UpdateState> & Pick<UpdateState, 'status'>): void {
    this.state = { current: this.o.currentVersion, checkedAt: this.state.checkedAt, ...patch }
    this.o.onState(this.getState())
  }

  private wire(): void {
    const u = this.o.updater!
    const [owner, repo] = this.o.repo.split('/')
    u.setFeedURL({ provider: 'github', owner, repo })
    u.autoDownload = false // quem decide é a pessoa
    u.autoInstallOnAppQuit = true // se baixou e ela deixou para depois, instala ao fechar
    u.allowPrerelease = false

    u.on('checking-for-update', () => this.set({ status: 'checking' }))
    u.on('update-available', (info: { version?: string; releaseNotes?: unknown }) =>
      this.set({
        status: 'available',
        latest: String(info?.version ?? ''),
        notes: notesToText(info?.releaseNotes),
        checkedAt: new Date().toISOString()
      })
    )
    u.on('update-not-available', () => this.set({ status: 'idle', checkedAt: new Date().toISOString() }))
    u.on('download-progress', (p: { percent?: number }) =>
      this.set({
        status: 'downloading',
        latest: this.state.latest,
        notes: this.state.notes,
        percent: Math.max(0, Math.min(100, Math.round(Number(p?.percent) || 0)))
      })
    )
    u.on('update-downloaded', () => this.set({ status: 'ready', latest: this.state.latest, notes: this.state.notes }))
    u.on('error', (err: unknown) => {
      // Sem internet não é um problema que a pessoa precise ver: volta a "idle" quando só estava verificando.
      const message = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'Falha ao atualizar'
      if (this.state.status === 'checking') this.set({ status: 'idle' })
      else this.set({ status: 'error', latest: this.state.latest, notes: this.state.notes, message })
    })
  }

  /** `manual` = a pessoa clicou em "Verificar": mostra o erro se a verificação falhar. */
  async check(manual = false): Promise<UpdateState> {
    if (!this.active) return this.getState()
    const busy = ['checking', 'downloading', 'ready'].includes(this.state.status)
    if (busy) return this.getState()
    try {
      await this.o.updater!.checkForUpdates()
    } catch (err) {
      if (manual) {
        const message = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'Sem conexão'
        this.set({ status: 'error', message: `Não foi possível verificar: ${message}` })
      } else if (this.state.status === 'checking') {
        this.set({ status: 'idle' })
      }
    }
    return this.getState()
  }

  async download(): Promise<UpdateState> {
    if (!this.active || this.state.status !== 'available') return this.getState()
    this.set({ status: 'downloading', latest: this.state.latest, notes: this.state.notes, percent: 0 })
    try {
      await this.o.updater!.downloadUpdate()
    } catch {
      /* o evento 'error' já informou a tela */
    }
    return this.getState()
  }

  install(): boolean {
    if (!this.active || this.state.status !== 'ready') return false
    // (silencioso, reabrir o app depois da instalação)
    this.o.updater!.quitAndInstall(false, true)
    return true
  }

  /** Verifica pouco depois de abrir e de tempos em tempos (o app costuma ficar aberto o dia todo). */
  startSchedule(firstDelayMs = 15_000, everyMs = 4 * 60 * 60 * 1000): void {
    if (!this.active || this.timer) return
    const first = setTimeout(() => void this.check(false), firstDelayMs)
    first.unref?.()
    this.timer = setInterval(() => void this.check(false), everyMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
