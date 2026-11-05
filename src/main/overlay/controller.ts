// src/main/overlay/controller.ts
// Janela do overlay: transparente, sempre no topo e que deixa o mouse passar (clique atravessa para o jogo).
// Não injeta nada no jogo: é uma janela comum do app, então só aparece com o LoL em janela ou borderless.
import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { applyBuildSelection, ZERO_SELECTION, type BuildSelection } from '../../shared/buildSelection'
import type { AppSettings, ChampionBuild, MetaDataset } from '../../shared/dataTypes'
import { computeOverlay, type LiveSnapshot, type OverlayCorner, type OverlayState } from '../../shared/overlay'
import type { Role } from '../../shared/types'
import { rolesOf } from '../data/metaStats'
import { fetchLive, parseLive } from './live'

const WIDTH = 300
const HEIGHT = 330
const MARGIN = 16
const FAST_MS = 1500
const IDLE_MS = 6000
const PREVIEW_MS = 12_000

export interface OverlayDeps {
  getSettings: () => AppSettings
  getDataset: () => MetaDataset | null
  getBuild: (championId: number, role: Role) => ChampionBuild | null
  /** "Ahri" (id do Data Dragon) → 103 */
  idOfKey: (key: string) => number | null
  nameOf: (championId: number) => string
  /** opção de build que a pessoa mandou para o LoL neste campeão/rota (null = a mais usada) */
  lastSelection: (championId: number, role: Role) => BuildSelection | null
  /** rota e campeão do último draft (para quando o jogo não informa a rota) */
  lastDraftPick: () => { championId: number; role: Role } | null
  /** abre o catálogo (ids de campeão) antes da primeira leitura */
  warm: () => Promise<void>
  send: (channel: string, payload: unknown) => void
  channel: string
  log: (message: string) => void
}

export function cornerPosition(corner: OverlayCorner, area: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  const left = corner === 'tl' || corner === 'bl'
  const top = corner === 'tl' || corner === 'tr'
  return {
    x: left ? area.x + MARGIN : area.x + area.width - WIDTH - MARGIN,
    y: top ? area.y + MARGIN + 80 : area.y + area.height - HEIGHT - MARGIN - 80
  }
}

/** Estado de demonstração a partir de um campeão que tenha build com os 18 níveis de habilidade. */
export function demoState(ds: MetaDataset | null, nameOf: (id: number) => string): OverlayState | null {
  if (!ds || ds.isSample) return null
  for (const [id, c] of Object.entries(ds.champions)) {
    for (const [role, m] of Object.entries(c.roles)) {
      const b = m?.build
      if (!b?.skillOrder?.levels || b.items.core.length < 3) continue
      const levels = b.skillOrder.levels
      const abilities = { Q: 0, W: 0, E: 0, R: 0 }
      for (const k of levels.slice(0, 8)) abilities[k]++
      const live: LiveSnapshot = {
        gameTime: 720,
        level: 9,
        abilities,
        items: [...b.items.boots, b.items.core[0]],
        championKey: null,
        championName: nameOf(Number(id)),
        role: role as Role
      }
      return { ...computeOverlay({ championId: Number(id), role: role as Role, build: b, live }), demo: true }
    }
  }
  return null
}

export class OverlayController {
  private win: BrowserWindow | null = null
  private timer: NodeJS.Timeout | null = null
  private state: OverlayState | null = null
  private lastJson = ''
  private previewUntil = 0
  private running = false
  private stopped = false

  constructor(private readonly deps: OverlayDeps, parent: BrowserWindow, private readonly devUrl: string | undefined) {
    parent.on('closed', () => this.destroy())
  }

  getState(): OverlayState | null {
    return this.state
  }

  /** Chamar ao iniciar e sempre que as configurações mudarem. */
  refresh(): void {
    if (this.stopped) return
    const s = this.deps.getSettings()
    if (s.overlayEnabled) {
      if (!this.running) {
        this.running = true
        void this.tick()
      }
      this.applyWindowSettings()
    } else {
      this.running = false
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      if (this.previewUntil <= Date.now()) this.setState(null)
    }
  }

  /** Mostra uma demonstração por alguns segundos (mesmo com o overlay desligado). */
  preview(): boolean {
    const demo = demoState(this.deps.getDataset(), this.deps.nameOf)
    if (!demo) return false
    this.previewUntil = Date.now() + PREVIEW_MS
    this.setState(demo)
    setTimeout(() => {
      if (Date.now() >= this.previewUntil) this.setState(this.running ? this.live : null)
    }, PREVIEW_MS + 100)
    return true
  }

  destroy(): void {
    this.stopped = true
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private live: OverlayState | null = null

  private async tick(): Promise<void> {
    if (!this.running || this.stopped) return
    let next: number = IDLE_MS
    try {
      const snap = parseLive(await fetchLive())
      this.live = snap ? await this.stateFor(snap) : null
      if (this.live) next = FAST_MS
      if (this.previewUntil <= Date.now()) this.setState(this.live)
    } catch (err) {
      this.deps.log(`overlay: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (this.running && !this.stopped) this.timer = setTimeout(() => void this.tick(), next)
  }

  private async stateFor(snap: LiveSnapshot): Promise<OverlayState | null> {
    await this.deps.warm()
    const id = snap.championKey ? this.deps.idOfKey(snap.championKey) : null
    if (id === null) return null
    const ds = this.deps.getDataset()
    const pick = this.deps.lastDraftPick()
    const role: Role | null = snap.role ?? (pick && pick.championId === id ? pick.role : null) ?? (ds ? rolesOf(ds, id)[0] : null) ?? null
    if (!role) return null
    const base = this.deps.getBuild(id, role)
    if (!base) return null
    const build = applyBuildSelection(base, this.deps.lastSelection(id, role) ?? ZERO_SELECTION)
    return computeOverlay({ championId: id, role, build, live: { ...snap, championName: snap.championName || this.deps.nameOf(id) } })
  }

  private setState(state: OverlayState | null): void {
    this.state = state
    const json = JSON.stringify(state)
    if (json !== this.lastJson) {
      this.lastJson = json
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send(this.deps.channel, state)
    }
    if (state) this.show()
    else this.hide()
  }

  private applyWindowSettings(): void {
    if (!this.win || this.win.isDestroyed()) return
    const area = screen.getPrimaryDisplay().workArea
    const pos = cornerPosition(this.deps.getSettings().overlayCorner, area)
    this.win.setBounds({ x: pos.x, y: pos.y, width: WIDTH, height: HEIGHT })
    this.win.setOpacity(this.deps.getSettings().overlayOpacity)
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      fullscreenable: false,
      backgroundColor: '#00000000',
      title: 'Pedro.gg Overlay',
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true, { forward: false }) // o clique atravessa o painel e vai para o jogo
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.on('closed', () => {
      this.win = null
    })
    this.win = win
    this.applyWindowSettings()
    if (this.devUrl) void win.loadURL(`${this.devUrl}#overlay`)
    else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
    return win
  }

  private show(): void {
    const win = this.ensureWindow()
    this.applyWindowSettings()
    if (!win.isVisible()) win.showInactive()
  }

  private hide(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide()
  }
}
