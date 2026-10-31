// src/main/data/meta.ts
// Dataset de meta (winrates, matchups, builds). O app não depende de um site específico:
// lê um arquivo JSON (schema em shared/dataTypes.ts) que o usuário pode importar/atualizar.
import { promises as fs } from 'node:fs'
import type { Role } from '../../shared/types'
import {
  ROLES,
  type ChampionBuild,
  type MetaDataset,
  type MetaInfo,
  type RoleMeta,
  type SkillKey,
  type WinStats
} from '../../shared/dataTypes'
import { readJson, writeJsonAtomic } from '../store/fsJson'

const MAX_IMPORT_BYTES = 64 * 1024 * 1024
const SKILL_KEYS: readonly string[] = ['Q', 'W', 'E', 'R']

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

function asStats(v: unknown): WinStats | null {
  if (!isRecord(v)) return null
  const { games, wins } = v
  if (typeof games !== 'number' || typeof wins !== 'number') return null
  if (!Number.isFinite(games) || !Number.isFinite(wins) || games < 0 || wins < 0 || wins > games) return null
  return { games, wins }
}

const idList = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : []

/** Runas e feitiços são opcionais: dado fora do formato é ignorado, nunca derruba o arquivo inteiro. */
function parseRunes(raw: Json): Pick<ChampionBuild, 'runes' | 'spells'> {
  const out: Pick<ChampionBuild, 'runes' | 'spells'> = {}
  const r = raw.runes
  if (isRecord(r) && Number.isInteger(r.primaryStyleId) && Number.isInteger(r.subStyleId) && Array.isArray(r.perkIds)) {
    const ids = r.perkIds.filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
    const styles = [r.primaryStyleId as number, r.subStyleId as number]
    if (ids.length === 9 && styles.every((n) => n > 0) && styles[0] !== styles[1]) {
      out.runes = { primaryStyleId: styles[0], subStyleId: styles[1], perkIds: ids }
    }
  }
  if (Array.isArray(raw.spells) && raw.spells.length === 2 && raw.spells.every((n) => Number.isInteger(n) && (n as number) > 0) && raw.spells[0] !== raw.spells[1]) {
    out.spells = [raw.spells[0] as number, raw.spells[1] as number]
  }
  return out
}

function parseBuild(raw: unknown): ChampionBuild | undefined {
  if (!isRecord(raw) || !isRecord(raw.skillOrder) || !isRecord(raw.items)) return undefined
  const skills = (v: unknown): SkillKey[] =>
    Array.isArray(v) ? v.filter((k): k is SkillKey => typeof k === 'string' && SKILL_KEYS.includes(k)) : []
  const priority = skills(raw.skillOrder.priority)
  if (!priority.length) return undefined
  const levels = skills(raw.skillOrder.levels)

  const situational = Array.isArray(raw.items.situational)
    ? raw.items.situational.flatMap((s: unknown) =>
        isRecord(s) && Number.isInteger(s.itemId) && typeof s.when === 'string'
          ? [{ itemId: s.itemId as number, when: s.when.slice(0, 120) }]
          : []
      )
    : []

  return {
    ...parseRunes(raw),
    skillOrder: { priority, ...(levels.length ? { levels } : {}) },
    items: {
      starting: idList(raw.items.starting),
      boots: idList(raw.items.boots),
      core: idList(raw.items.core),
      situational
    }
  }
}

/** Valida e normaliza. Lança com a primeira inconsistência encontrada (mensagem para o usuário). */
export function validateDataset(raw: unknown): MetaDataset {
  if (!isRecord(raw) || raw.schemaVersion !== 1) throw new Error('schemaVersion inválido (esperado 1)')
  if (typeof raw.patch !== 'string' || !raw.patch) throw new Error('Campo "patch" ausente')
  if (!isRecord(raw.champions)) throw new Error('Campo "champions" ausente')

  const champions: MetaDataset['champions'] = {}
  for (const [id, c] of Object.entries(raw.champions)) {
    if (!/^\d+$/.test(id) || !isRecord(c) || !isRecord(c.roles)) throw new Error(`Campeão inválido: ${id}`)
    const roles: Partial<Record<Role, RoleMeta>> = {}
    for (const role of ROLES) {
      const r = c.roles[role]
      if (r === undefined) continue
      const stats = asStats(r)
      if (!stats || !isRecord(r)) throw new Error(`Estatística inválida: ${id}/${role}`)

      const matchups: Record<string, WinStats> = {}
      if (r.matchups !== undefined) {
        if (!isRecord(r.matchups)) throw new Error(`Matchups inválidos: ${id}/${role}`)
        for (const [vs, s] of Object.entries(r.matchups)) {
          const ms = asStats(s)
          if (!/^\d+$/.test(vs) || !ms) throw new Error(`Matchup inválido: ${id}/${role}/${vs}`)
          matchups[vs] = ms
        }
      }
      const synergies: Record<string, WinStats> = {}
      if (r.synergies !== undefined) {
        if (!isRecord(r.synergies)) throw new Error(`Sinergias inválidas: ${id}/${role}`)
        for (const [mate, s] of Object.entries(r.synergies)) {
          const ss = asStats(s)
          if (!/^\d+$/.test(mate) || !ss) throw new Error(`Sinergia inválida: ${id}/${role}/${mate}`)
          synergies[mate] = ss
        }
      }
      const build = parseBuild(r.build)
      roles[role] = {
        ...stats,
        matchups,
        ...(Object.keys(synergies).length ? { synergies } : {}),
        ...(build ? { build } : {})
      }
    }
    champions[id] = { roles }
  }

  return {
    schemaVersion: 1,
    source: typeof raw.source === 'string' ? raw.source.slice(0, 60) : 'unknown',
    isSample: raw.isSample === true,
    patch: raw.patch,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
    champions
  }
}

const UPDATE_TIMEOUT_MS = 20_000

/** kind: 'network' = sem internet/servidor fora; 'invalid' = o arquivo baixado não serve. */
export class MetaUpdateError extends Error {
  constructor(
    readonly kind: 'network' | 'invalid',
    message: string
  ) {
    super(message)
    this.name = 'MetaUpdateError'
  }
}

export interface MetaUpdateResult {
  /** false = o servidor já tinha a mesma versão que o app */
  changed: boolean
  info: MetaInfo
}

export class MetaStore {
  private dataset: MetaDataset | null = null

  /**
   * @param userFile    dataset do usuário (userData/meta/meta.json) — tem prioridade
   * @param bundledFile dataset de amostra que acompanha o instalador
   */
  constructor(
    private readonly userFile: string,
    private readonly bundledFile: string
  ) {}

  async load(): Promise<void> {
    this.dataset = null
    for (const file of [this.userFile, this.bundledFile]) {
      const raw = await readJson(file)
      if (raw === null) continue
      try {
        this.dataset = validateDataset(raw)
        return
      } catch {
        /* arquivo inválido: tenta o próximo */
      }
    }
  }

  get(): MetaDataset | null {
    return this.dataset
  }

  info(): MetaInfo | null {
    const d = this.dataset
    if (!d) return null
    return {
      source: d.source,
      patch: d.patch,
      generatedAt: d.generatedAt,
      isSample: d.isSample === true || d.source === 'sample',
      champions: Object.keys(d.champions).length
    }
  }

  getBuild(championId: number, role: Role): ChampionBuild | null {
    return this.dataset?.champions[String(championId)]?.roles[role]?.build ?? null
  }

  /**
   * Baixa o meta.json publicado pelo autor. Nunca troca o dataset atual por um arquivo inválido,
   * e só aceita https. Usa ETag para não baixar de novo o que o app já tem.
   */
  async updateFromUrl(url: string, fetchFn: typeof fetch = fetch): Promise<MetaUpdateResult> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new MetaUpdateError('invalid', 'Endereço inválido')
    }
    if (parsed.protocol !== 'https:') throw new MetaUpdateError('invalid', 'O endereço precisa começar com https://')

    const etagFile = `${this.userFile}.etag`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.dataset && !this.dataset.isSample) {
      try {
        await fs.access(this.userFile)
        const etag = (await fs.readFile(etagFile, 'utf8')).trim()
        if (etag) headers['If-None-Match'] = etag
      } catch {
        /* sem etag guardado: baixa normalmente */
      }
    }

    let res: Response
    try {
      res = await fetchFn(parsed.href, { headers, signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) })
    } catch {
      throw new MetaUpdateError('network', 'Não foi possível acessar o servidor')
    }
    if (res.status === 304 && this.dataset) return { changed: false, info: this.info() as MetaInfo }
    if (!res.ok) throw new MetaUpdateError('network', `O servidor respondeu ${res.status}`)
    if (res.url && !res.url.startsWith('https:')) throw new MetaUpdateError('invalid', 'O servidor redirecionou para um endereço sem https')

    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_IMPORT_BYTES) throw new MetaUpdateError('invalid', 'Arquivo grande demais')
    let text: string
    try {
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_IMPORT_BYTES) throw new MetaUpdateError('invalid', 'Arquivo grande demais')
      text = buf.toString('utf8')
    } catch (err) {
      if (err instanceof MetaUpdateError) throw err
      throw new MetaUpdateError('network', 'A conexão caiu durante o download')
    }

    let dataset: MetaDataset
    try {
      dataset = validateDataset(JSON.parse(text))
    } catch (err) {
      throw new MetaUpdateError('invalid', `Arquivo de meta inválido: ${err instanceof Error ? err.message : 'formato desconhecido'}`)
    }

    const prev = this.dataset
    const same =
      prev !== null &&
      !prev.isSample &&
      prev.generatedAt === dataset.generatedAt &&
      prev.patch === dataset.patch &&
      prev.source === dataset.source

    await writeJsonAtomic(this.userFile, dataset)
    const etag = res.headers.get('etag')
    if (etag) await fs.writeFile(etagFile, etag, 'utf8').catch(() => undefined)
    else await fs.rm(etagFile, { force: true })
    this.dataset = dataset
    return { changed: !same, info: this.info() as MetaInfo }
  }

  /** Importa um arquivo escolhido pelo usuário. Só substitui o atual se for válido. */
  async importFrom(file: string): Promise<MetaInfo> {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > MAX_IMPORT_BYTES) throw new Error('Arquivo inválido ou grande demais')
    const dataset = validateDataset(JSON.parse(await fs.readFile(file, 'utf8')))
    await writeJsonAtomic(this.userFile, dataset)
    this.dataset = dataset
    return this.info() as MetaInfo
  }
}
