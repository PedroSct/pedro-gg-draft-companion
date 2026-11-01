// src/main/data/ddragon.ts
// Cliente do Riot Data Dragon (ícones e dados oficiais) com cache em disco:
// depois da primeira execução o app funciona offline com a última versão baixada.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Catalog, ChampionInfo, ItemInfo, NamedIcon, SpellInfo } from '../../shared/dataTypes'
import { readJson, writeJsonAtomic } from '../store/fsJson'

const DEFAULT_BASE = 'https://ddragon.leagueoflegends.com'
const TIMEOUT_MS = 8000
const VERSION_RE = /^\d+\.\d+\.\d+$/
const KEY_RE = /^[A-Za-z0-9]{1,32}$/
const LOCALE_RE = /^[a-z]{2}_[A-Z]{2}$/
const SLOTS = ['Q', 'W', 'E', 'R'] as const

export interface DataDragonOptions {
  cacheDir: string
  getLocale?: () => string
  fetchFn?: typeof fetch
  baseUrl?: string
}

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, '')

function infoOf(raw: unknown): Pick<ChampionInfo, 'info'> {
  if (!isRecord(raw)) return {}
  const { attack, defense, magic, difficulty } = raw
  if ([attack, defense, magic, difficulty].some((n) => typeof n !== 'number')) return {}
  return { info: { attack: attack as number, defense: defense as number, magic: magic as number, difficulty: difficulty as number } }
}

function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function assertVersion(v: string): void {
  if (!VERSION_RE.test(v)) throw new Error('Versão do Data Dragon inválida')
}

export class DataDragon {
  private readonly cacheDir: string
  private readonly getLocale: () => string
  private readonly fetchFn: typeof fetch
  private readonly baseUrl: string
  private readonly catalogs = new Map<string, Promise<Catalog>>()

  constructor(opts: DataDragonOptions) {
    this.cacheDir = opts.cacheDir
    this.getLocale = opts.getLocale ?? (() => 'pt_BR')
    this.fetchFn = opts.fetchFn ?? fetch
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE
  }

  private locale(): string {
    const l = this.getLocale()
    return LOCALE_RE.test(l) ? l : 'pt_BR'
  }

  // ---------------------------------------------------------- versões

  /** Mais nova primeiro. Rede → cache de versions.json → pastas já baixadas. */
  async getVersions(): Promise<string[]> {
    const file = path.join(this.cacheDir, 'versions.json')
    try {
      const raw = await this.fetchJson(`${this.baseUrl}/api/versions.json`)
      if (Array.isArray(raw)) {
        const versions = raw.filter((v): v is string => typeof v === 'string' && VERSION_RE.test(v))
        if (versions.length) {
          await writeJsonAtomic(file, versions).catch(() => undefined)
          return versions
        }
      }
    } catch {
      /* offline ou Data Dragon fora do ar: tenta o cache */
    }

    const cached = await readJson<unknown>(file)
    if (Array.isArray(cached)) {
      const versions = cached.filter((v): v is string => typeof v === 'string' && VERSION_RE.test(v))
      if (versions.length) return versions
    }
    try {
      const dirs = (await fs.readdir(this.cacheDir)).filter((d) => VERSION_RE.test(d))
      if (dirs.length) return dirs.sort(compareVersionsDesc)
    } catch {
      /* sem cache */
    }
    throw new Error('Data Dragon indisponível e sem cache local')
  }

  /**
   * "auto" acompanha o patch do cliente (ex.: build 16.20.612.4409 → 16.20.x).
   * O Data Dragon costuma sair com atraso após o patch; sem correspondência, usa a mais nova.
   */
  async resolveVersion(preferred = 'auto', gameVersion?: string | null): Promise<string> {
    if (preferred !== 'auto' && VERSION_RE.test(preferred)) return preferred
    const versions = await this.getVersions()
    const mm = gameVersion?.match(/^(\d+)\.(\d+)\./)
    if (mm) {
      const hit = versions.find((v) => v.startsWith(`${mm[1]}.${mm[2]}.`))
      if (hit) return hit
    }
    return versions[0]
  }

  // --------------------------------------------------------- catálogo

  getCatalog(version: string): Promise<Catalog> {
    // Sempre devolve Promise (nunca lança de forma síncrona), mesmo para versão inválida.
    if (!VERSION_RE.test(version)) return Promise.reject(new Error('Versão do Data Dragon inválida'))
    const locale = this.locale()
    const k = `${version}|${locale}`
    let p = this.catalogs.get(k)
    if (!p) {
      p = this.buildCatalog(version, locale)
      this.catalogs.set(k, p)
      p.catch(() => this.catalogs.delete(k)) // falha não fica presa na memória
    }
    return p
  }

  private async buildCatalog(version: string, locale: string): Promise<Catalog> {
    const [champRaw, itemRaw] = await Promise.all([
      this.dataFile(version, locale, 'champion.json'),
      this.dataFile(version, locale, 'item.json')
    ])
    if (!isRecord(champRaw) || !isRecord(champRaw.data)) throw new Error('champion.json inesperado')
    if (!isRecord(itemRaw) || !isRecord(itemRaw.data)) throw new Error('item.json inesperado')

    const champions: ChampionInfo[] = []
    for (const c of Object.values(champRaw.data)) {
      if (!isRecord(c) || !isRecord(c.image)) continue
      const id = Number(c.key)
      if (!Number.isInteger(id) || typeof c.id !== 'string' || typeof c.name !== 'string') continue
      champions.push({
        id,
        key: c.id,
        name: c.name,
        iconUrl: this.imgUrl(version, 'champion', String(c.image.full)),
        tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === 'string') : [],
        ...infoOf(c.info)
      })
    }
    champions.sort((a, b) => a.name.localeCompare(b.name, locale.replace('_', '-')))

    const items: Record<string, ItemInfo> = {}
    for (const [id, it] of Object.entries(itemRaw.data)) {
      if (!isRecord(it) || !isRecord(it.image) || typeof it.name !== 'string') continue
      const gold = isRecord(it.gold) && typeof it.gold.total === 'number' ? it.gold.total : 0
      items[id] = {
        id: Number(id),
        name: it.name,
        iconUrl: this.imgUrl(version, 'item', String(it.image.full)),
        goldTotal: gold,
        ...(Array.isArray(it.tags) ? { tags: it.tags.filter((t): t is string => typeof t === 'string') } : {})
      }
    }
    const [runes, summoners] = await Promise.all([this.runesOf(version, locale), this.summonersOf(version, locale)])
    return { version, locale, champions, items, ...(runes ? { runes } : {}), ...(summoners ? { summoners } : {}) }
  }

  /** Árvores e runas com nome e ícone. Parte opcional: se falhar, o catálogo segue sem runas. */
  private async runesOf(version: string, locale: string): Promise<Record<string, NamedIcon> | undefined> {
    try {
      const raw = await this.dataFile(version, locale, 'runesReforged.json')
      if (!Array.isArray(raw)) return undefined
      const out: Record<string, NamedIcon> = {}
      const add = (o: unknown): void => {
        if (!isRecord(o) || typeof o.id !== 'number' || typeof o.name !== 'string' || typeof o.icon !== 'string') return
        if (!/^[\w\-./]+$/.test(o.icon) || o.icon.includes('..')) return
        out[String(o.id)] = { name: o.name, iconUrl: `${this.baseUrl}/cdn/img/${o.icon}` }
      }
      for (const style of raw) {
        add(style)
        if (!isRecord(style) || !Array.isArray(style.slots)) continue
        for (const slot of style.slots) if (isRecord(slot) && Array.isArray(slot.runes)) slot.runes.forEach(add)
      }
      return Object.keys(out).length ? out : undefined
    } catch {
      return undefined
    }
  }

  private async summonersOf(version: string, locale: string): Promise<Record<string, NamedIcon> | undefined> {
    try {
      const raw = await this.dataFile(version, locale, 'summoner.json')
      if (!isRecord(raw) || !isRecord(raw.data)) return undefined
      const out: Record<string, NamedIcon> = {}
      for (const s of Object.values(raw.data)) {
        if (!isRecord(s) || !isRecord(s.image) || typeof s.name !== 'string') continue
        const id = Number(s.key)
        if (!Number.isInteger(id)) continue
        out[String(id)] = { name: s.name, iconUrl: `${this.baseUrl}/cdn/${version}/img/spell/${encodeURIComponent(String(s.image.full))}` }
      }
      return Object.keys(out).length ? out : undefined
    } catch {
      return undefined
    }
  }

  /** Passiva + Q/W/E/R do campeão (descrições sem HTML). `key` = id do Data Dragon, ex.: "Ahri". */
  async getSpells(version: string, key: string): Promise<SpellInfo[]> {
    assertVersion(version)
    if (!KEY_RE.test(key)) throw new Error('Campeão inválido') // também impede path traversal no cache
    const raw = await this.dataFile(version, this.locale(), `champion/${key}.json`)
    const c = isRecord(raw) && isRecord(raw.data) ? Object.values(raw.data)[0] : null
    if (!isRecord(c) || !Array.isArray(c.spells)) throw new Error('Dados do campeão inesperados')

    const out: SpellInfo[] = []
    if (isRecord(c.passive) && isRecord(c.passive.image)) {
      out.push({
        slot: 'P',
        name: String(c.passive.name ?? ''),
        description: stripTags(String(c.passive.description ?? '')),
        iconUrl: this.imgUrl(version, 'passive', String(c.passive.image.full))
      })
    }
    c.spells.slice(0, 4).forEach((s: unknown, i: number) => {
      if (!isRecord(s) || !isRecord(s.image)) return
      out.push({
        slot: SLOTS[i],
        name: String(s.name ?? ''),
        description: stripTags(String(s.description ?? '')),
        iconUrl: this.imgUrl(version, 'spell', String(s.image.full))
      })
    })
    return out
  }

  imgUrl(version: string, kind: 'champion' | 'item' | 'spell' | 'passive', file: string): string {
    return `${this.baseUrl}/cdn/${version}/img/${kind}/${encodeURIComponent(file)}`
  }

  // ------------------------------------------------------------ rede

  private async dataFile(version: string, locale: string, rel: string): Promise<unknown> {
    const file = path.join(this.cacheDir, version, locale, ...rel.split('/'))
    const cached = await readJson(file)
    if (cached) return cached
    const json = await this.fetchJson(`${this.baseUrl}/cdn/${version}/data/${locale}/${rel}`)
    await writeJsonAtomic(file, json).catch(() => undefined) // cache é "melhor esforço"
    return json
  }

  private async fetchJson(url: string): Promise<unknown> {
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Data Dragon HTTP ${res.status}`)
    return res.json()
  }
}
