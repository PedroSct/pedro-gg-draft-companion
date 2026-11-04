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

/** Endpoints de leitura que o app usa; o teste mostra quais respondem neste cliente. */
export const PROBE_PATHS: Array<{ label: string; path: string }> = [
  { label: 'Fase da partida', path: '/lol-gameflow/v1/gameflow-phase' },
  { label: 'Invocador', path: '/lol-summoner/v1/current-summoner' },
  { label: 'Seleção de campeões', path: '/lol-champ-select/v1/session' },
  { label: 'Páginas de runas', path: '/lol-perks/v1/pages' },
  { label: 'Fim de jogo', path: '/lol-end-of-game/v1/eog-stats-block' }
]

export interface ProbeIo {
  get(path: string): Promise<{ status: number; data: unknown }>
}

export interface ProbeLine {
  label: string
  path: string
  /** HTTP; 0 = o cliente nem respondeu */
  status: number
  ok: boolean
}

/** Consulta cada endpoint e devolve o código HTTP (404 em champ-select/fim de jogo é normal fora dessas fases). */
export async function probeClient(io: ProbeIo): Promise<ProbeLine[]> {
  const out: ProbeLine[] = []
  for (const p of PROBE_PATHS) {
    try {
      const r = await io.get(p.path)
      out.push({ ...p, status: r.status, ok: r.status >= 200 && r.status < 300 })
    } catch {
      out.push({ ...p, status: 0, ok: false })
    }
  }
  return out
}

export function formatProbe(lines: ProbeLine[]): string[] {
  return lines.map((l) => `${l.ok ? 'OK ' : l.status === 404 ? '-- ' : 'ERR'} ${l.label}: ${l.status === 0 ? 'sem resposta' : `HTTP ${l.status}`}`)
}
