// tools/build-meta.ts
// Gera o meta.json (winrates, confrontos, builds e habilidades) a partir da Match-v5 da Riot.
//
//   set RIOT_API_KEY=RGAPI-...        (Windows)   |   export RIOT_API_KEY=RGAPI-...
//   npm run meta:build -- --platform br1 --max-matches 3000
//
import { parseArgs } from 'node:util'
import { RiotAuthError } from './meta/riot'
import { buildMeta } from './meta/run'

const HELP = `Uso: npm run meta:build -- [opções]

Requer a variável de ambiente RIOT_API_KEY (developer.riotgames.com).

  --platform <br1|na1|euw1|kr|...>  servidor dos jogadores (padrão: br1)
  --tiers <lista>                    challenger,grandmaster,master (padrão: os três)
  --patch <auto|16.20>               patch alvo (padrão: auto = o mais recente do Data Dragon)
  --max-matches <n>                  partidas a coletar (padrão: 3000)
  --per-player <n>                   partidas recentes lidas de cada jogador (padrão: 10)
  --days <n>                         só partidas dos últimos n dias (padrão: 14)
  --rps <n>                          requisições por segundo (padrão: 0.8, o limite da chave de desenvolvimento)
  --no-timeline                      não baixa timelines: sem builds, metade das requisições
  --min-games <n>                    jogos mínimos de um campeão numa rota (padrão: 30)
  --min-matchup-games <n>            jogos mínimos de um confronto (padrão: 8)
  --min-build-samples <n>            vitórias mínimas para publicar uma build (padrão: 15)
  --out <arquivo>                    saída (padrão: meta.json)
  --work <pasta>                     checkpoint (padrão: meta-work)
  --finalize-only                    só refaz o meta.json a partir do checkpoint
  --seed <n>                         semente da ordem dos jogadores (padrão: 1)

Interrompeu? Rode o mesmo comando de novo: ele retoma de onde parou.`

const { values: v } = parseArgs({
  // O pnpm repassa o "--" ao script; ele não é um argumento.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    platform: { type: 'string', default: 'br1' },
    tiers: { type: 'string', default: 'challenger,grandmaster,master' },
    patch: { type: 'string', default: 'auto' },
    'max-matches': { type: 'string', default: '3000' },
    'per-player': { type: 'string', default: '10' },
    days: { type: 'string', default: '14' },
    rps: { type: 'string', default: '0.8' },
    'no-timeline': { type: 'boolean', default: false },
    'min-games': { type: 'string', default: '30' },
    'min-matchup-games': { type: 'string', default: '8' },
    'min-build-samples': { type: 'string', default: '15' },
    out: { type: 'string', default: 'meta.json' },
    work: { type: 'string', default: 'meta-work' },
    'finalize-only': { type: 'boolean', default: false },
    seed: { type: 'string', default: '1' },
    help: { type: 'boolean', short: 'h', default: false }
  }
})

function num(name: string, raw: string | undefined, min: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min) {
    console.error(`Valor inválido para --${name}: ${raw}`)
    process.exit(2)
  }
  return n
}

async function main(): Promise<void> {
  if (v.help) return console.log(HELP)
  const apiKey = process.env.RIOT_API_KEY?.trim()
  if (!apiKey && !v['finalize-only']) {
    console.error('Defina a variável de ambiente RIOT_API_KEY com a sua chave da Riot (veja --help).')
    process.exit(2)
  }

  const controller = new AbortController()
  process.once('SIGINT', () => {
    console.error('\nInterrompendo… salvando o progresso.')
    controller.abort()
  })

  await buildMeta({
    apiKey: apiKey ?? '',
    platform: String(v.platform),
    tiers: String(v.tiers).split(',').map((t) => t.trim()).filter(Boolean),
    patch: String(v.patch),
    maxMatches: num('max-matches', v['max-matches'], 1),
    matchesPerPlayer: Math.min(100, num('per-player', v['per-player'], 1)),
    days: num('days', v.days, 1),
    rps: num('rps', v.rps, 0.01),
    workDir: String(v.work),
    out: String(v.out),
    minGames: num('min-games', v['min-games'], 1),
    minMatchupGames: num('min-matchup-games', v['min-matchup-games'], 1),
    minBuildSamples: num('min-build-samples', v['min-build-samples'], 1),
    timeline: !v['no-timeline'],
    seed: num('seed', v.seed, 1),
    finalizeOnly: Boolean(v['finalize-only']),
    signal: controller.signal,
    log: (m) => console.error(m)
  })
}

main().catch((err: unknown) => {
  console.error(err instanceof RiotAuthError ? err.message : `Erro: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
