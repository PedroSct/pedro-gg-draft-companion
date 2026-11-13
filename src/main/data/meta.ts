// src/main/data/meta.ts
// Dataset de meta (winrates, matchups, builds). O app não depende de um site específico:
// lê um arquivo JSON (schema em shared/dataTypes.ts) que o usuário pode importar/atualizar.
import { promises as fs } from 'node:fs'
import type { Role } from '../../shared/types'
import {
  ROLES,
  type BuildOption,
  type BuildOptions,
  type BuildVariant,
  type ChampionBuild,
  type ChampionProfile,
  type MatchupBuild,
  type MetaDataset,
  type MetaInfo,
  type RoleMeta,
  type RunePage,
  type SkillKey,
  type WinStats
} from '../../shared/dataTypes'
import { readJson, writeJsonAtomic } from '../store/fsJson'
import { withMatchupBuild } from './matchupBuild'

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

function parseProfile(raw: unknown): ChampionProfile | undefined {
  if (!isRecord(raw)) return undefined
  const n = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null)
  const physical = n(raw.physical, 1)
  const magic = n(raw.magic, 1)
  const tru = n(raw.true, 1)
  const durability = n(raw.durability, 100_000)
  const cc = n(raw.cc, 1000)
  if (physical === null || magic === null || tru === null || durability === null || cc === null) return undefined
  return { physical, magic, true: tru, durability, cc }
}

function parseVariants(raw: unknown): BuildVariant[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 5).flatMap((v: unknown) => {
    if (!isRecord(v)) return []
    const core = idList(v.core)
    if (core.length !== 3 || typeof v.share !== 'number' || !(v.share >= 0 && v.share <= 1)) return []
    return [{ core, ...(Number.isInteger(v.boots) && (v.boots as number) > 0 ? { boots: v.boots as number } : {}), share: v.share }]
  })
}

function asOpt<T>(v: unknown, parse: (value: unknown) => T | null): BuildOption<T>[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, 8).flatMap((o: unknown) => {
    if (!isRecord(o)) return []
    const stats = asStats(o)
    const value = stats ? parse(o.value) : null
    return stats && value !== null ? [{ value, games: stats.games, wins: stats.wins }] : []
  })
}

function parseOptions(raw: unknown): BuildOptions | undefined {
  if (!isRecord(raw)) return undefined
  const games = typeof raw.games === 'number' && raw.games >= 0 ? raw.games : 0
  const timeline = typeof raw.timeline === 'number' && raw.timeline >= 0 ? raw.timeline : 0
  const runes = asOpt<RunePage>(raw.runes, (v) => parseRunes({ runes: v }).runes ?? null)
  const spells = asOpt<[number, number]>(raw.spells, (v) => parseRunes({ spells: v }).spells ?? null)
  const starting = asOpt<number[]>(raw.starting, (v) => {
    const list = idList(v)
    return list.length ? list : null
  })
  const boots = asOpt<number>(raw.boots, (v) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null))
  const core = asOpt<number[]>(raw.core, (v) => {
    const list = idList(v)
    return list.length === 3 ? list : null
  })
  const skills = asOpt<{ priority: SkillKey[]; levels?: SkillKey[] }>(raw.skills, (v) => {
    if (!isRecord(v)) return null
    const pick = (x: unknown): SkillKey[] => (Array.isArray(x) ? x.filter((k): k is SkillKey => typeof k === 'string' && SKILL_KEYS.includes(k)) : [])
    const priority = pick(v.priority)
    const levels = pick(v.levels)
    return priority.length ? { priority, ...(levels.length === 18 ? { levels } : {}) } : null
  })
  const out: BuildOptions = {
    games,
    timeline,
    ...(runes.length ? { runes } : {}),
    ...(spells.length ? { spells } : {}),
    ...(starting.length ? { starting } : {}),
    ...(boots.length ? { boots } : {}),
    ...(core.length ? { core } : {}),
    ...(skills.length ? { skills } : {})
  }
  return Object.keys(out).length > 2 ? out : undefined
}

/** Runas e feitiços por oponente de rota (opcional: entrada ruim é ignorada, nunca derruba o arquivo). */
function parseMatchupBuilds(raw: unknown): Record<string, MatchupBuild> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, MatchupBuild> = {}
  for (const [enemy, v] of Object.entries(raw)) {
    if (!/^\d+$/.test(enemy) || !isRecord(v)) continue
    const games = typeof v.games === 'number' && v.games > 0 ? v.games : 0
    const runes = asOpt<RunePage>([v.runes], (x) => parseRunes({ runes: x }).runes ?? null)[0]
    const spells = asOpt<[number, number]>([v.spells], (x) => parseRunes({ spells: x }).spells ?? null)[0]
    if (games > 0 && (runes || spells)) out[enemy] = { games, ...(runes ? { runes } : {}), ...(spells ? { spells } : {}) }
  }
  return Object.keys(out).length ? out : undefined
}

function parseBuild(raw: unknown): ChampionBuild | undefined {
  if (!isRecord(raw) || !isRecord(raw.items)) return undefined
  const skills = (v: unknown): SkillKey[] =>
    Array.isArray(v) ? v.filter((k): k is SkillKey => typeof k === 'string' && SKILL_KEYS.includes(k)) : []
  const priority = isRecord(raw.skillOrder) ? skills(raw.skillOrder.priority) : []
  const levels = isRecord(raw.skillOrder) ? skills(raw.skillOrder.levels) : []

  const situational = Array.isArray(raw.items.situational)
    ? raw.items.situational.flatMap((s: unknown) =>
        isRecord(s) && Number.isInteger(s.itemId) && typeof s.when === 'string'
          ? [{ itemId: s.itemId as number, when: s.when.slice(0, 120) }]
          : []
      )
    : []

  const variants = parseVariants(raw.variants)
  const options = parseOptions(raw.options)
  const items = {
    starting: idList(raw.items.starting),
    boots: idList(raw.items.boots),
    core: idList(raw.items.core),
    situational
  }
  const runesSpells = parseRunes(raw)
  // Uma build precisa de pelo menos uma parte útil
  if (!priority.length && !runesSpells.runes && !runesSpells.spells && !options && !items.core.length && !items.starting.length && !items.boots.length) return undefined
  return {
    ...runesSpells,
    ...(variants.length ? { variants } : {}),
    ...(options ? { options } : {}),
    ...(priority.length ? { skillOrder: { priority, ...(levels.length ? { levels } : {}) } } : {}),
    items
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
      const versus: Record<string, WinStats> = {}
      if (isRecord(r.versus)) {
        for (const [foe, s] of Object.entries(r.versus)) {
          const vs = asStats(s)
          if (/^\d+$/.test(foe) && vs) versus[foe] = vs // opcional: entrada ruim é ignorada
        }
      }
      const profile = parseProfile(r.profile)
      const build = parseBuild(r.build)
      const matchupBuilds = parseMatchupBuilds(r.matchupBuilds)
      roles[role] = {
        ...stats,
        matchups,
        ...(Object.keys(synergies).length ? { synergies } : {}),
        ...(Object.keys(versus).length ? { versus } : {}),
        ...(profile ? { profile } : {}),
        ...(build ? { build } : {}),
        ...(matchupBuilds ? { matchupBuilds } : {})
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
    ...(Array.isArray(raw.regions)
      ? { regions: raw.regions.filter((x): x is string => typeof x === 'string' && /^[a-z0-9]{2,8}$/.test(x)).slice(0, 24) }
      : {}),
    champions
  }
}

const UPDATE_TIMEOUT_MS = 20_000

/** kind: 'network' = sem internet/servidor fora; 'invalid' = o arquivo baixado não serve. */
/** Segue no máximo 3 redirecionamentos e recusa qualquer um que saia do https, antes de baixar o conteúdo. */
async function fetchHttps(fetchFn: typeof fetch, url: string, headers: Record<string, string>): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetchFn(current, { headers, redirect: 'manual', signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) })
    if (res.status < 300 || res.status >= 400 || res.status === 304) return res
    const loc = res.headers.get('location')
    let next: URL
    try {
      next = new URL(loc ?? '', current)
    } catch {
      throw new MetaUpdateError('invalid', 'O servidor mandou um redirecionamento inválido')
    }
    if (next.protocol !== 'https:') throw new MetaUpdateError('invalid', 'O servidor redirecionou para um endereço sem https')
    current = next.href
  }
  throw new MetaUpdateError('invalid', 'Redirecionamentos demais')
}

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
      champions: Object.keys(d.champions).length,
      ...(d.regions?.length ? { regions: d.regions } : {})
    }
  }

  /** Com o oponente de rota conhecido, as runas e os feitiços mais usados contra ele passam a ser o padrão (se houver amostra). */
  getBuild(championId: number, role: Role, enemyId?: number | null): ChampionBuild | null {
    const r = this.dataset?.champions[String(championId)]?.roles[role]
    const base = r?.build ?? null
    if (!base || !enemyId || enemyId <= 0) return base
    return withMatchupBuild(base, r?.matchupBuilds?.[String(enemyId)], enemyId)
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
      res = await fetchHttps(fetchFn, parsed.href, headers)
    } catch (err) {
      if (err instanceof MetaUpdateError) throw err
      throw new MetaUpdateError('network', 'Não foi possível acessar o servidor')
    }
    if (res.status === 304 && this.dataset) return { changed: false, info: this.info() as MetaInfo }
    if (res.status === 404)
      throw new MetaUpdateError('network', 'Esse arquivo de dados ainda não foi publicado (rode o workflow “Atualizar dados de meta”)')
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
