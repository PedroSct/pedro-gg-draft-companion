// src/main/postgame/store.ts
// Histórico local das partidas analisadas (últimas 40) + cópia bruta das últimas respostas do cliente.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { summarize, type PgDetail, type PgSummary, type MatchReport, type Analysis } from '../../shared/postgame'

const MAX_ITEMS = 40
const MAX_RAW = 5

interface Item {
  report: MatchReport
  analysis: Analysis
  savedAt: number
}

export class PostGameStore {
  private items: Item[] | null = null
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly rawDir: string
  ) {}

  private async load(): Promise<Item[]> {
    if (this.items) return this.items
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      const list = typeof parsed === 'object' && parsed !== null ? (parsed as { items?: unknown }).items : null
      this.items = Array.isArray(list)
        ? (list.filter(
            (i): i is Item =>
              typeof i === 'object' && i !== null && typeof (i as Item).report?.gameId === 'number' && typeof (i as Item).analysis?.score === 'number'
          ) as Item[])
        : []
    } catch {
      this.items = [] // arquivo ausente ou corrompido: começa vazio
    }
    return this.items
  }

  private persist(items: Item[]): Promise<void> {
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ version: 1, items }), 'utf8')
      await fs.rename(tmp, this.file)
    })
    return this.writing
  }

  async list(): Promise<PgSummary[]> {
    const items = await this.load()
    return items.map((i) => summarize(i.report, i.analysis, i.savedAt))
  }

  async get(gameId: number): Promise<PgDetail | null> {
    const i = (await this.load()).find((x) => x.report.gameId === gameId)
    return i ? { report: i.report, analysis: i.analysis } : null
  }

  async has(gameId: number): Promise<boolean> {
    return (await this.get(gameId)) !== null
  }

  /** Salva (ou substitui) a partida; a mais recente fica primeiro. */
  async put(report: MatchReport, analysis: Analysis, now = Date.now()): Promise<PgSummary> {
    const items = (await this.load()).filter((x) => x.report.gameId !== report.gameId)
    items.unshift({ report, analysis, savedAt: now })
    this.items = items.slice(0, MAX_ITEMS)
    await this.persist(this.items)
    return summarize(report, analysis, now)
  }

  async remove(gameId: number): Promise<void> {
    const items = (await this.load()).filter((x) => x.report.gameId !== gameId)
    this.items = items
    await this.persist(items)
  }

  /** Guarda as respostas brutas do cliente: se o formato mudar num patch, dá para ver o que veio. */
  async saveRaw(gameId: number, raw: unknown): Promise<void> {
    try {
      await fs.mkdir(this.rawDir, { recursive: true })
      await fs.writeFile(path.join(this.rawDir, `${gameId}.json`), JSON.stringify(raw), 'utf8')
      const files = (await fs.readdir(this.rawDir)).filter((f) => f.endsWith('.json'))
      const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(path.join(this.rawDir, f))).mtimeMs })))
      stats.sort((a, b) => b.t - a.t)
      await Promise.all(stats.slice(MAX_RAW).map((s) => fs.rm(path.join(this.rawDir, s.f), { force: true })))
    } catch {
      /* cópia bruta é só diagnóstico */
    }
  }
}
