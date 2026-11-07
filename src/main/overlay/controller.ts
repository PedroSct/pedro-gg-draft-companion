// src/main/overlay/controller.ts
// Janela do overlay: transparente, sempre no topo e que deixa o mouse passar (clique atravessa para o jogo).
// Não injeta nada no jogo: é uma janela comum do app, então só aparece com o LoL em janela ou borderless.
import { join } from 'node:path'
import { BrowserWindow, globalShortcut, screen } from 'electron'
import { applyBuildSelection, ZERO_SELECTION, type BuildSelection } from '../../shared/buildSelection'
import type { AppSettings, ChampionBuild, MetaDataset } from '../../shared/dataTypes'
import { computeOverlay, type LiveSnapshot, type MatchSituation, type OverlayCorner, type OverlayState } from '../../shared/overlay'
import type { Role } from '../../shared/types'
import { rolesOf } from '../data/metaStats'
import { ForegroundWatcher, isGameProcess } from './foreground'
import { fetchLive, parseLive } from './live'
import { formatAccelerator } from '../../shared/shortcuts'

export type PanelSize = { width: number; height: number }
const FULL: PanelSize = { width: 320, height: 520 }
/** O recuado é bem menor; a folga em cima do banner do modo mover cabe na altura. */
const COMPACT: PanelSize = { width: 300, height: 150 }
const sizeOf = (compact: boolean): PanelSize => (compact ? COMPACT : FULL)
const MARGIN = 16
const FAST_MS = 2500
const IDLE_MS = 6000
const PREVIEW_MS = 12_000

export interface OverlayDeps {
  getSettings: () => AppSettings
  /** situação do time inimigo desta partida (itens que ajudam contra ele); null se não há dados */
  situation: (championId: number, role: Role, enemyIds: number[]) => MatchSituation | null
  /** guarda uma configuração do overlay (ex.: recuado/estendido pelo atalho) */
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  /** guarda a posição escolhida arrastando (null = volta ao canto) */
  savePosition: (pos: { x: number; y: number } | null) => Promise<void>
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

export function cornerPosition(corner: OverlayCorner, area: { x: number; y: number; width: number; height: number }, size: PanelSize = FULL): { x: number; y: number } {
  const left = corner === 'tl' || corner === 'bl'
  const top = corner === 'tl' || corner === 'tr'
  return {
    x: left ? area.x + MARGIN : area.x + area.width - size.width - MARGIN,
    y: top ? area.y + MARGIN + 80 : area.y + area.height - size.height - MARGIN - 80
  }
}

type Area = { x: number; y: number; width: number; height: number }

/** Posição final do painel: a escolhida arrastando (se ainda cai numa tela conectada) ou o canto. */
export function resolvePosition(
  pos: { x: number; y: number } | null,
  corner: OverlayCorner,
  areas: Area[],
  size: PanelSize = FULL
): { x: number; y: number } {
  if (pos) {
    const inside = areas.find((a) => pos.x + 40 >= a.x && pos.x + 40 <= a.x + a.width && pos.y + 40 >= a.y && pos.y + 40 <= a.y + a.height)
    if (inside) {
      // mantém o painel inteiro dentro da tela
      return {
        x: Math.min(Math.max(pos.x, inside.x), inside.x + inside.width - size.width),
        y: Math.min(Math.max(pos.y, inside.y), inside.y + inside.height - size.height)
      }
    }
  }
  return cornerPosition(corner, areas[0] ?? { x: 0, y: 0, width: 1920, height: 1080 }, size)
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
  private status = 'desligado'
  /** o LoL está em primeiro plano? (true também quando não dá para saber: aí o painel aparece sempre) */
  private gameFocused = true
  /** modo mover: o painel aceita o mouse para ser arrastado */
  private editing = false
  private readonly watcher = new ForegroundWatcher((name) => this.onForeground(name))

  constructor(private readonly deps: OverlayDeps, parent: BrowserWindow, private readonly devUrl: string | undefined) {
    parent.on('closed', () => this.destroy())
  }

  getState(): OverlayState | null {
    return this.state
  }

  /** O que o overlay está fazendo agora (vai no relatório de diagnóstico: explica por que não apareceu). */
  getStatus(): string {
    return this.status
  }

  private setStatus(status: string): void {
    if (status === this.status) return
    this.status = status
    this.deps.log(status)
  }

  /** Chamar ao iniciar e sempre que as configurações mudarem. */
  refresh(): void {
    if (this.stopped) return
    const s = this.deps.getSettings()
    if (s.overlayEnabled) {
      if (!this.running) {
        this.setStatus('ligado, aguardando uma partida')
        this.watcher.start()
        this.running = true
        void this.tick()
      }
      this.registerShortcut() // também quando só o atalho mudou
      this.applyWindowSettings()
    } else {
      this.setStatus('desligado nas configurações')
      this.watcher.stop()
      this.unregisterShortcut()
      if (this.editing) this.endEdit(false)
      this.gameFocused = true
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
      if (!this.editing && Date.now() >= this.previewUntil) this.setState(this.running ? this.live : null)
    }, PREVIEW_MS + 100)
    return true
  }

  /**
   * Atalhos globais (configuráveis): um alterna recuado/estendido, outro liga o modo mover. Só mexem na janela do overlay.
   * `register` devolve false quando outro programa já usa a combinação; o resultado fica no relatório de diagnóstico.
   */
  private keys: { size: string | null; move: string | null } = { size: null, move: null }
  private keyStatus = 'não registrados'
  getShortcutStatus(): string {
    return this.keyStatus
  }
  private registerShortcut(): void {
    const s = this.deps.getSettings()
    const want = { size: s.overlayKeySize, move: s.overlayKeyMove }
    if (this.keys.size === want.size && this.keys.move === want.move) return
    this.unregisterShortcut()
    const note: string[] = []
    const reg = (acc: string, label: string, fn: () => void): string | null => {
      if (!acc) return null
      try {
        if (globalShortcut.register(acc, fn)) {
          note.push(`${label} ${formatAccelerator(acc)} ok`)
          return acc
        }
      } catch {
        /* cai no aviso abaixo */
      }
      note.push(`${label} ${formatAccelerator(acc)} NÃO registrou (outro programa já usa; troque em Configurações > Partida)`)
      return null
    }
    this.keys = {
      size: reg(want.size, 'tamanho', () => void this.toggleCompact()),
      move: want.move === want.size ? (note.push('mover: igual ao do tamanho, ignorado'), null) : reg(want.move, 'mover', () => (this.editing ? void this.finishMove() : void this.startMove()))
    }
    this.keyStatus = note.join(', ')
    this.deps.log(`atalhos: ${this.keyStatus}`)
  }
  private unregisterShortcut(): void {
    for (const acc of [this.keys.size, this.keys.move]) {
      if (!acc) continue
      try {
        globalShortcut.unregister(acc)
      } catch {
        /* ignora */
      }
    }
    this.keys = { size: null, move: null }
    this.keyStatus = 'não registrados'
  }

  /** Alterna entre o painel recuado (só o próximo item) e o estendido (build completa). */
  async toggleCompact(): Promise<void> {
    await this.deps.saveSettings({ overlayCompact: !this.deps.getSettings().overlayCompact })
    this.refresh()
    this.lastJson = ''
    const base = this.editing ? this.state : this.live
    if (base) this.setState(base)
  }

  /** Liga o modo mover: mostra o painel (da partida, ou de exemplo) e deixa arrastar com o mouse. */
  startMove(): boolean {
    if (this.editing) return true
    const base = this.live ?? demoState(this.deps.getDataset(), this.deps.nameOf)
    if (!base) return false
    this.editing = true
    const win = this.ensureWindow()
    win.setFocusable(true)
    win.setIgnoreMouseEvents(false)
    win.setMovable(true)
    this.lastJson = ''
    this.setState(base)
    this.deps.log('overlay: modo mover ligado')
    return true
  }

  /** Salva onde o painel ficou e volta ao modo normal (clique passa direto para o jogo). */
  async finishMove(): Promise<void> {
    if (!this.editing) return
    const win = this.win && !this.win.isDestroyed() ? this.win : null
    const b = win?.getBounds()
    this.endEdit(true)
    if (b) await this.deps.savePosition({ x: b.x, y: b.y })
    this.applyWindowSettings()
    this.deps.log(`overlay: posição salva (${b?.x},${b?.y})`)
  }

  private endEdit(refresh: boolean): void {
    this.editing = false
    this.previewUntil = 0
    const win = this.win && !this.win.isDestroyed() ? this.win : null
    if (win) {
      win.setMovable(false)
      win.setIgnoreMouseEvents(true, { forward: false })
      win.setFocusable(false)
    }
    this.lastJson = ''
    if (refresh) this.setState(this.live)
  }

  destroy(): void {
    this.stopped = true
    this.running = false
    this.editing = false
    this.watcher.stop()
    this.unregisterShortcut()
    if (this.timer) clearTimeout(this.timer)
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  private live: OverlayState | null = null

  private async tick(): Promise<void> {
    if (!this.running || this.stopped) return
    let next: number = IDLE_MS
    try {
      const raw = await fetchLive()
      const snap = parseLive(raw)
      if (raw === null) this.setStatus('ligado, aguardando uma partida (a API da partida não respondeu)')
      else if (!snap) this.setStatus('partida detectada, mas não é o Summoner\'s Rift clássico ou os dados vieram incompletos')
      this.live = snap ? await this.stateFor(snap) : null
      if (this.live) next = this.gameFocused ? FAST_MS : IDLE_MS
      if (this.editing) {
        if (this.live) this.setState(this.live)
      } else if (this.previewUntil <= Date.now()) this.setState(this.live)
    } catch (err) {
      this.deps.log(`overlay: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (this.running && !this.stopped) this.timer = setTimeout(() => void this.tick(), next)
  }

  private async stateFor(snap: LiveSnapshot): Promise<OverlayState | null> {
    await this.deps.warm()
    const id = snap.championKey ? this.deps.idOfKey(snap.championKey) : null
    if (id === null) {
      this.setStatus(`partida detectada (${snap.championName || snap.championKey || '?'}), mas o catálogo de campeões não carregou (precisa de internet na 1ª vez)`)
      return null
    }
    const ds = this.deps.getDataset()
    const pick = this.deps.lastDraftPick()
    const role: Role | null = snap.role ?? (pick && pick.championId === id ? pick.role : null) ?? (ds ? rolesOf(ds, id)[0] : null) ?? null
    if (!role) {
      this.setStatus(`partida detectada (${this.deps.nameOf(id)}), mas não foi possível descobrir a rota`)
      return null
    }
    const base = this.deps.getBuild(id, role)
    if (!base) {
      this.setStatus(`partida detectada (${this.deps.nameOf(id)}, ${role}), mas os dados de meta não têm build para esse campeão nessa rota`)
      return null
    }
    const build = applyBuildSelection(base, this.deps.lastSelection(id, role) ?? ZERO_SELECTION)
    this.setStatus(`mostrando o painel: ${this.deps.nameOf(id)} (${role})`)
    const enemyIds = (snap.enemyKeys ?? []).map((k) => this.deps.idOfKey(k)).filter((x): x is number => x !== null)
    const situation = enemyIds.length > 0 ? this.deps.situation(id, role, enemyIds) : null
    return computeOverlay({ championId: id, role, build, situation, live: { ...snap, championName: snap.championName || this.deps.nameOf(id) } })
  }

  private setState(raw: OverlayState | null): void {
    const compact = this.deps.getSettings().overlayCompact
    const state = raw ? { ...raw, ...(compact ? { compact: true } : {}), ...(this.editing ? { editing: true } : {}) } : raw
    this.state = state
    const json = JSON.stringify(state)
    if (json !== this.lastJson) {
      this.lastJson = json
      if (this.win && !this.win.isDestroyed()) this.win.webContents.send(this.deps.channel, state)
    }
    this.applyVisibility()
  }

  private onForeground(name: string | null): void {
    // null = não consegui observar: mantém o painel sempre visível durante a partida
    const focused = name === null ? true : isGameProcess(name)
    if (focused === this.gameFocused) return
    this.gameFocused = focused
    this.applyVisibility()
  }

  /** O painel só fica na tela com a partida em andamento E o jogo na frente (a demonstração aparece sempre). */
  private applyVisibility(): void {
    const previewing = this.previewUntil > Date.now() || this.editing
    if (this.state && (this.gameFocused || previewing)) this.show()
    else this.hide()
  }

  private applyWindowSettings(): void {
    if (!this.win || this.win.isDestroyed()) return
    const st = this.deps.getSettings()
    const size = sizeOf(st.overlayCompact)
    if (!this.editing) {
      const areas = [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter((d) => d.id !== screen.getPrimaryDisplay().id)].map((d) => d.workArea)
      const pos = resolvePosition(st.overlayPos, st.overlayCorner, areas, size)
      this.win.setBounds({ x: pos.x, y: pos.y, width: size.width, height: size.height })
    } else {
      const b = this.win.getBounds()
      this.win.setBounds({ x: b.x, y: b.y, width: size.width, height: size.height })
    }
    this.win.setOpacity(this.editing ? 1 : st.overlayOpacity)
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: FULL.width,
      height: FULL.height,
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
