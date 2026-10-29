// tools/meta/run.ts
// Fluxo completo: Data Dragon (patch e itens) → jogadores do ladder → partidas → agregação → meta.json.
// Guarda um checkpoint: se parar (Ctrl+C, chave expirada, queda de internet), basta rodar de novo.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic, readJson } from '../../src/main/store/fsJson'
import { validateDataset } from '../../src/main/data/meta'
import type { MetaDataset } from '../../src/shared/dataTypes'
import {
  addMatch,
  finalize,
  itemRulesFrom,
  newState,
  patchOf,
  type AggState,
  type ItemRules,
  type RawMatch,
  type RawTimeline
} from './aggregate'
import { REGION_OF_PLATFORM, RiotClient } from './riot'

export interface BuildMetaOptions {
  apiKey: string
  platform: string
  tiers: string[]
  /** "auto" = patch mais recente do Data Dragon */
  patch: string
  maxMatches: number
  matchesPerPlayer: number
  /** só partidas dos últimos N dias */
  days: number
  rps: number
  workDir: string
  out: string
  minGames: number
  minMatchupGames: number
  minBuildSamples: number
  /** false = não baixa timelines (sem builds, só winrates e confrontos; metade das requisições) */
  timeline: boolean
  seed: number
  /** substitui os hosts da Riot (testes) */
  riotBase?: string
  ddragonBase?: string
  finalizeOnly?: boolean
  signal?: AbortSignal
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

interface RunState {
  agg: AggState
  puuids: string[]
  cursor: number
  processed: string[]
}

const CHECKPOINT_EVERY = 25
const TIER_PATH: Record<string, string> = {
  challenger: 'challengerleagues',
  grandmaster: 'grandmasterleagues',
  master: 'masterleagues'
}

/** Embaralha de forma determinística (mesma semente, mesma ordem). */
function shuffle<T>(items: T[], seed: number): T[] {
  let s = (seed >>> 0) || 1
  const rnd = (): number => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0xffffffff
  }
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function buildMeta(o: BuildMetaOptions): Promise<MetaDataset> {
  const log = o.log ?? (() => undefined)
  const fetchFn = o.fetchFn ?? fetch
  const ddragon = o.ddragonBase ?? 'https://ddragon.leagueoflegends.com'

  // ---- Data Dragon: patch alvo e regras de itens
  const versions = (await (await fetchFn(`${ddragon}/api/versions.json`)).json()) as string[]
  const latest = versions.find((v) => /^\d+\.\d+\.\d+$/.test(v))
  if (!latest) throw new Error('Não foi possível ler as versões do Data Dragon')
  const patch = o.patch === 'auto' ? patchOf(latest) : o.patch
  const ddVersion = versions.find((v) => patchOf(v) === patch) ?? latest
  const itemRes = await fetchFn(`${ddragon}/cdn/${ddVersion}/data/en_US/item.json`)
  if (!itemRes.ok) throw new Error(`Não foi possível ler os itens do Data Dragon (${itemRes.status})`)
  const rules: ItemRules = itemRulesFrom(await itemRes.json())
  log(`Patch alvo: ${patch} (Data Dragon ${ddVersion})`)

  // ---- Checkpoint
  await fs.mkdir(o.workDir, { recursive: true })
  const stateFile = path.join(o.workDir, `state-${o.platform}-${patch}.json`)
  const saved = await readJson<RunState>(stateFile)
  const run: RunState =
    saved && saved.agg?.patch === patch
      ? saved
      : { agg: newState(patch), puuids: [], cursor: 0, processed: [] }
  const processed = new Set(run.processed)
  const save = async (): Promise<void> => {
    run.processed = [...processed]
    await writeJsonAtomic(stateFile, run)
  }
  if (saved) log(`Retomando: ${run.agg.matches} partidas já contadas, jogador ${run.cursor}/${run.puuids.length}`)

  const region = REGION_OF_PLATFORM[o.platform]
  if (!region && !o.riotBase) throw new Error(`Plataforma desconhecida: ${o.platform}`)
  const client = new RiotClient({
    apiKey: o.apiKey,
    platformBase: o.riotBase ?? `https://${o.platform}.api.riotgames.com`,
    regionalBase: o.riotBase ?? `https://${region}.api.riotgames.com`,
    rps: o.rps,
    fetchFn,
    sleep: o.sleep,
    log
  })

  const finish = async (): Promise<MetaDataset> => {
    await save()
    const dataset = validateDataset(
      finalize(run.agg, {
        minGames: o.minGames,
        minMatchupGames: o.minMatchupGames,
        minBuildSamples: o.minBuildSamples,
        source: `Riot Match-v5, ${run.agg.matches} partidas`,
        generatedAt: new Date().toISOString()
      })
    )
    await writeJsonAtomic(o.out, dataset)
    log(`Gerado ${o.out}: ${Object.keys(dataset.champions).length} campeões, ${run.agg.matches} partidas`)
    return dataset
  }
  if (o.finalizeOnly) return finish()

  // ---- Jogadores do ladder (só na primeira vez)
  if (run.puuids.length === 0) {
    const found: string[] = []
    for (const tier of o.tiers) {
      const route = TIER_PATH[tier]
      if (!route) throw new Error(`Elo desconhecido: ${tier} (use challenger, grandmaster ou master)`)
      const league = await client.get<{ entries?: { puuid?: string; summonerId?: string }[] }>(
        'platform',
        `/lol/league/v4/${route}/by-queue/RANKED_SOLO_5x5`
      )
      for (const e of league?.entries ?? []) {
        if (e.puuid) found.push(e.puuid)
        else if (e.summonerId) {
          // Respostas antigas só traziam o summonerId
          const s = await client.get<{ puuid?: string }>('platform', `/lol/summoner/v4/summoners/${encodeURIComponent(e.summonerId)}`)
          if (s?.puuid) found.push(s.puuid)
        }
      }
      log(`${tier}: ${found.length} jogadores até agora`)
    }
    if (found.length === 0) throw new Error('Nenhum jogador encontrado no ladder. Confira a plataforma e a chave.')
    run.puuids = shuffle([...new Set(found)], o.seed)
    run.cursor = 0
    await save()
  }

  // ---- Partidas
  const startTime = Math.floor(Date.now() / 1000) - o.days * 86400
  let sinceSave = 0
  let aborted = false
  try {
    while (run.agg.matches < o.maxMatches && run.cursor < run.puuids.length) {
      if (o.signal?.aborted) {
        aborted = true
        break
      }
      const puuid = run.puuids[run.cursor]
      const ids =
        (await client.get<string[]>('regional', `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`, {
          queue: 420,
          type: 'ranked',
          start: 0,
          count: o.matchesPerPlayer,
          startTime
        })) ?? []

      let playerDone = true
      for (const id of ids) {
        if (run.agg.matches >= o.maxMatches || o.signal?.aborted) {
          playerDone = false // sobraram partidas deste jogador: ele volta na retomada
          break
        }
        if (processed.has(id)) continue
        const match = await client.get<RawMatch>('regional', `/lol/match/v5/matches/${encodeURIComponent(id)}`)
        processed.add(id) // mesmo as ignoradas: não baixar de novo
        if (!match) continue
        let timeline: RawTimeline | null = null
        // Só baixa a timeline de partidas que serão contadas (poupa uma requisição das rejeitadas)
        const counts = (match.info?.queueId === 420) && match.info?.gameEndedInEarlySurrender !== true &&
          typeof match.info?.gameVersion === 'string' && patchOf(match.info.gameVersion) === patch
        if (o.timeline && counts) timeline = await client.get<RawTimeline>('regional', `/lol/match/v5/matches/${encodeURIComponent(id)}/timeline`)
        if (addMatch(run.agg, match, timeline, rules)) {
          sinceSave++
          if (run.agg.matches % CHECKPOINT_EVERY === 0) log(`${run.agg.matches}/${o.maxMatches} partidas`)
        }
        if (sinceSave >= CHECKPOINT_EVERY) {
          sinceSave = 0
          await save()
        }
      }
      if (playerDone) run.cursor++
    }
  } catch (err) {
    await save() // preserva o progresso antes de propagar (chave expirada, rede...)
    throw err
  }
  if (aborted) log('Interrompido: gerando o arquivo com o que já foi coletado')
  if (run.agg.matches === 0) {
    await save()
    throw new Error('Nenhuma partida válida foi coletada. Aumente --days ou confira o patch (--patch).')
  }
  return finish()
}
