// tools/meta/run.ts
// Fluxo completo: Data Dragon (patch e itens) → jogadores do ladder → partidas → agregação → meta.json.
// Guarda um checkpoint: se parar (Ctrl+C, chave expirada, queda de internet), basta rodar de novo.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic, readJson } from '../../src/main/store/fsJson'
import { validateDataset } from '../../src/main/data/meta'
import type { MetaDataset } from '../../src/shared/dataTypes'
import {
  addHoldout,
  addMatch,
  finalize,
  isHoldout,
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
  /** páginas (205 jogadores cada) lidas por divisão nos elos Platina a Diamante; padrão 3 */
  entryPages?: number
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
  /** timelines só para as N primeiras partidas contadas (as demais entram só com winrates e confrontos); 0 = todas */
  timelineMatches?: number
  minPairGames?: number
  /** false = não baixa timelines (sem builds, só winrates e confrontos; metade das requisições) */
  timeline: boolean
  seed: number
  /** false = usa todas as partidas no meta (padrão: reserva 1 em cada 10 para medir a recomendação) */
  holdout?: boolean
  /** voltas completas pela lista de jogadores (padrão 50); 1 = só uma passada */
  maxPasses?: number
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
  /** início (segundos) do patch alvo, descoberto ao achar partidas do patch anterior: nada antes disso é baixado */
  floorTs?: number
  /** elos que já entraram na lista de jogadores (para acrescentar novos ao retomar) */
  tiers?: string[]
  puuids: string[]
  cursor: number
  processed: string[]
}

const CHECKPOINT_EVERY = 25
/** Elos com divisões (IV a I): lidos pela lista de entradas, algumas páginas por divisão. */
const DIVISION_TIERS = new Set(['platinum', 'emerald', 'diamond'])
const DIVISIONS = ['I', 'II', 'III', 'IV']
const TIER_PATH: Record<string, string> = {
  challenger: 'challengerleagues',
  grandmaster: 'grandmasterleagues',
  master: 'masterleagues'
}

/** 16.21 < 16.22 < 17.1 (só versões "X.Y"). */
export function patchOlder(version: string, target: string): boolean {
  const num = (v: string): number[] => v.split('.').map((n) => Number(n) || 0)
  const [a1 = 0, a2 = 0] = num(patchOf(version))
  const [b1 = 0, b2 = 0] = num(target)
  return a1 < b1 || (a1 === b1 && a2 < b2)
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
  const stateFile = path.join(o.workDir, `state-v3-${o.platform}-${patch}.json`)
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
        minPairGames: o.minPairGames,
        minBuildSamples: o.minBuildSamples,
        source: `Riot Match-v5 (${o.platform}), ${run.agg.matches} partidas`,
        generatedAt: new Date().toISOString(),
        regions: [o.platform]
      })
    )
    await writeJsonAtomic(o.out, dataset)
    log(`Gerado ${o.out}: ${Object.keys(dataset.champions).length} campeões, ${run.agg.matches} partidas`)
    return dataset
  }
  if (o.finalizeOnly) return finish()

  // ---- Jogadores do ladder (na primeira vez; ao retomar, só os elos que ainda não estavam na lista)
  const wantedTiers = [...new Set(o.tiers)]
  for (const tier of wantedTiers) if (!TIER_PATH[tier] && !DIVISION_TIERS.has(tier)) throw new Error(`Elo desconhecido: ${tier} (use challenger, grandmaster, master, diamond, emerald ou platinum)`)
  const knownTiers = new Set(run.tiers ?? (run.puuids.length > 0 ? ['challenger', 'grandmaster', 'master'] : []))
  const newTiers = wantedTiers.filter((t) => !knownTiers.has(t))
  if (newTiers.length > 0) {
    const found: string[] = []
    for (const tier of newTiers) {
      if (TIER_PATH[tier]) {
        const league = await client.get<{ entries?: { puuid?: string; summonerId?: string }[] }>(
          'platform',
          `/lol/league/v4/${TIER_PATH[tier]}/by-queue/RANKED_SOLO_5x5`
        )
        for (const e of league?.entries ?? []) {
          if (e.puuid) found.push(e.puuid)
          else if (e.summonerId) {
            // Respostas antigas só traziam o summonerId
            const s = await client.get<{ puuid?: string }>('platform', `/lol/summoner/v4/summoners/${encodeURIComponent(e.summonerId)}`)
            if (s?.puuid) found.push(s.puuid)
          }
        }
      } else {
        // Elos com divisões: poucas páginas de cada divisão bastam (cada uma traz até 205 jogadores)
        for (const division of DIVISIONS) {
          for (let page = 1; page <= (o.entryPages ?? 3); page++) {
            const list = await client.get<{ puuid?: string }[]>('platform', `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier.toUpperCase()}/${division}`, { page })
            if (!Array.isArray(list) || list.length === 0) break
            for (const e of list) if (e.puuid) found.push(e.puuid)
          }
        }
      }
      log(`${tier}: ${found.length} jogadores até agora`)
    }
    if (found.length === 0 && run.puuids.length === 0) throw new Error('Nenhum jogador encontrado no ladder. Confira a plataforma e a chave.')
    // Jogadores novos entram misturados com os que ainda faltam; quem já foi lido continua no começo da lista.
    const have = new Set(run.puuids)
    const fresh = [...new Set(found)].filter((id) => !have.has(id))
    const done = run.puuids.slice(0, run.cursor)
    run.puuids = [...done, ...shuffle([...run.puuids.slice(run.cursor), ...fresh], o.seed)]
    run.tiers = [...knownTiers, ...newTiers]
    await save()
    if (run.puuids.length > 0 && saved) log(`Lista de jogadores: ${run.puuids.length} (${fresh.length} novos)`)
  }

  // ---- Partidas
  const daysStart = Math.floor(Date.now() / 1000) - o.days * 86400
  let sinceSave = 0
  let aborted = false
  try {
    // Ao chegar ao fim da lista de jogadores com tempo e vagas sobrando, o coletor dá outra volta: as ids dos
    // jogadores mudam com o tempo (partidas novas) e as já contadas são ignoradas. Se a volta não trouxe nada, para.
    let passStart = run.agg.matches
    let pass = 1
    for (;;) {
      while (run.agg.matches < o.maxMatches && run.cursor < run.puuids.length) {
        if (o.signal?.aborted) {
          aborted = true
          break
        }
        const puuid = run.puuids[run.cursor]
        // Logo depois de um patch quase tudo no período é do patch antigo: depois da primeira partida velha achada,
        // só se pede o que veio depois dela (as ids vêm da mais nova para a mais velha).
        const startTime = Math.max(daysStart, run.floorTs ?? 0)
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
          const ver = match.info?.gameVersion
          if (typeof ver === 'string' && patchOlder(ver, patch)) {
            // Partida do patch anterior: as próximas deste jogador são ainda mais velhas, e o patch começou depois desta.
            if (typeof match.info?.gameCreation === 'number') {
              const floor = Math.floor(match.info.gameCreation / 1000) + 1
              if (floor > (run.floorTs ?? 0)) {
                if (run.floorTs === undefined) log(`Partidas do patch anterior: pedindo só o que veio depois de ${new Date(floor * 1000).toISOString()}`)
                run.floorTs = floor
              }
            }
            break
          }
          if (o.holdout !== false && isHoldout(id)) {
          // Reservada só para teste da recomendação: não entra nas contagens nem baixa a timeline.
          if (addHoldout(run.agg, match)) sinceSave++
          continue
        }
        let timeline: RawTimeline | null = null
          // Só baixa a timeline de partidas que serão contadas (poupa uma requisição das rejeitadas)
          const counts = (match.info?.queueId === 420) && match.info?.gameEndedInEarlySurrender !== true &&
            typeof match.info?.gameVersion === 'string' && patchOf(match.info.gameVersion) === patch
          const withinBudget = !o.timelineMatches || (run.agg.timelineMatches ?? 0) < o.timelineMatches
          if (o.timeline && counts && withinBudget) timeline = await client.get<RawTimeline>('regional', `/lol/match/v5/matches/${encodeURIComponent(id)}/timeline`)
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
      if (aborted || o.signal?.aborted || run.agg.matches >= o.maxMatches || run.cursor < run.puuids.length) break
      if (run.agg.matches === passStart || run.puuids.length === 0 || pass >= (o.maxPasses ?? 50)) break
    pass++
      log(`Lista de jogadores lida até o fim (${run.agg.matches} partidas): nova volta`)
      run.cursor = 0
      passStart = run.agg.matches
      await save()
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
