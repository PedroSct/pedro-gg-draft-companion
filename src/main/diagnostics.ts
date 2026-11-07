// src/main/diagnostics.ts
// Registro curto do que o app viu e fez no cliente do LoL (sem senhas nem dados pessoais),
// para o usuário copiar e enviar quando algo não funcionar (ex.: o aceite automático).
import { promises as fs } from 'node:fs'
import path from 'node:path'

const MAX_LINES = 300

export interface AcceptResult {
  ok: boolean
  /** código HTTP do cliente; 0 = nem chegou a responder */
  status: number
  at: number
}

export class Diagnostics {
  private lines: string[] = []
  private lastAccept: AcceptResult | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now
  ) {}

  log(tag: string, message: string): void {
    const t = new Date(this.now()).toISOString().slice(11, 23)
    const line = `${t} [${tag}] ${message}`.slice(0, 400)
    this.lines.push(line)
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
    if (this.file) {
      const file = this.file
      this.writing = this.writing
        .then(async () => {
          await fs.mkdir(path.dirname(file), { recursive: true })
          await fs.appendFile(file, line + '\n', 'utf8')
          const st = await fs.stat(file)
          if (st.size > 256 * 1024) await fs.writeFile(file, this.lines.join('\n') + '\n', 'utf8')
        })
        .catch(() => undefined)
    }
  }

  setAccept(r: AcceptResult): void {
    this.lastAccept = r
  }

  getAccept(): AcceptResult | null {
    return this.lastAccept
  }

  /** Texto pronto para copiar. */
  report(header: string[]): string {
    return [...header, '', ...this.lines.slice(-120)].join('\n')
  }
}

/**
 * Endpoints de leitura que o app usa, cada um com o recurso que depende dele. `phaseOnly`: só existe numa fase do jogo
 * (seleção de campeões, fim de jogo), então 404 fora dela é normal.
 */
export const PROBE_PATHS: Array<{ label: string; path: string; phaseOnly?: boolean }> = [
  { label: 'Fase da partida (aceite automático, detecção do draft)', path: '/lol-gameflow/v1/gameflow-phase' },
  { label: 'Invocador (sua conta e amigos no time)', path: '/lol-summoner/v1/current-summoner' },
  { label: 'Seleção de campeões (draft ao vivo)', path: '/lol-champ-select/v1/session', phaseOnly: true },
  { label: 'Páginas de runas (importar runas)', path: '/lol-perks/v1/pages' },
  { label: 'Página de runas atual (importar runas)', path: '/lol-perks/v1/currentpage' },
  { label: 'Histórico de partidas (Pós-jogo, Importar Pool)', path: '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=1' },
  { label: 'Maestria de campeões (Importar Pool, conforto)', path: '/lol-champion-mastery/v1/local-player/champion-mastery' },
  { label: 'Fim de jogo (Pós-jogo automático)', path: '/lol-end-of-game/v1/eog-stats-block', phaseOnly: true }
]

export interface ProbeIo {
  get(path: string): Promise<{ status: number; data: unknown }>
  /** Live Client Data (overlay): true se a partida em andamento respondeu. Só existe dentro do jogo. */
  live?(): Promise<boolean>
}

export interface ProbeLine {
  label: string
  path: string
  /** HTTP; 0 = o cliente nem respondeu */
  status: number
  ok: boolean
  phaseOnly?: boolean
}

const ITEM_SETS_LABEL = 'Conjuntos de itens (importar build)'

/** Consulta cada endpoint e devolve o código HTTP (404 em champ-select/fim de jogo é normal fora dessas fases). */
export async function probeClient(io: ProbeIo): Promise<ProbeLine[]> {
  const out: ProbeLine[] = []
  let summonerId = ''
  for (const p of PROBE_PATHS) {
    try {
      const r = await io.get(p.path)
      out.push({ ...p, status: r.status, ok: r.status >= 200 && r.status < 300 })
      if (p.path.includes('current-summoner') && r.status === 200 && r.data && typeof r.data === 'object') {
        const id = (r.data as { summonerId?: unknown }).summonerId
        if (typeof id === 'number' || typeof id === 'string') summonerId = String(id)
      }
    } catch {
      out.push({ ...p, status: 0, ok: false })
    }
  }
  // Os conjuntos de itens ficam no id da conta; sem ele (conta não lida) o recurso também falharia.
  if (/^\d{1,20}$/.test(summonerId)) {
    const path = `/lol-item-sets/v1/item-sets/${summonerId}/sets`
    try {
      const r = await io.get(path)
      out.push({ label: ITEM_SETS_LABEL, path: '/lol-item-sets/v1/item-sets/{conta}/sets', status: r.status, ok: r.status >= 200 && r.status < 300 })
    } catch {
      out.push({ label: ITEM_SETS_LABEL, path: '/lol-item-sets/v1/item-sets/{conta}/sets', status: 0, ok: false })
    }
  } else {
    out.push({ label: ITEM_SETS_LABEL, path: '/lol-item-sets/v1/item-sets/{conta}/sets', status: 0, ok: false })
  }
  if (io.live) {
    let up = false
    try {
      up = await io.live()
    } catch {
      up = false
    }
    out.push({ label: 'Live Client (overlay, só dentro da partida)', path: 'liveclientdata', status: up ? 200 : 404, ok: up, phaseOnly: true })
  }
  return out
}

export function formatProbe(lines: ProbeLine[]): string[] {
  const rows = lines.map((l) => {
    const tag = l.ok ? 'OK ' : l.phaseOnly && l.status === 404 ? '-- ' : 'ERR'
    const what = l.status === 0 ? 'sem resposta' : l.path === 'liveclientdata' && !l.ok ? 'fora da partida (normal)' : `HTTP ${l.status}`
    return `${tag} ${l.label}: ${what}`
  })
  const bad = rows.filter((r) => r.startsWith('ERR')).length
  rows.push(bad === 0 ? 'Resumo: nada com erro. "--" é normal fora da fase indicada.' : `Resumo: ${bad} item(ns) com ERR; mande este resultado para o Pedro.`)
  return rows
}
