// tools/merge-meta.ts
// Junta as coletas de vários servidores (arquivos state-v2-<plataforma>-<patch>.json) em um único meta.json.
//
//   pnpm meta:merge --out meta.json states/state-v2-br1-16.21.json states/state-v2-kr-16.21.json
//
// As contagens são somadas (um servidor com mais partidas pesa mais). Coletas de outro patch são ignoradas.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { validateDataset } from '../src/main/data/meta'
import { writeJsonAtomic } from '../src/main/store/fsJson'
import { finalize, mergeStates, type AggState } from './meta/aggregate'

const { values: v, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'meta.json' },
    'min-games': { type: 'string', default: '30' },
    'min-matchup-games': { type: 'string', default: '8' },
    'min-build-samples': { type: 'string', default: '15' }
  }
})

interface Saved {
  agg?: AggState
}

function regionOf(file: string): string {
  return /state-v2-([a-z0-9]+)-/.exec(file)?.[1] ?? 'desconhecido'
}

function main(): void {
  if (positionals.length === 0) {
    console.error('Uso: pnpm meta:merge --out meta.json <state-v2-*.json>...')
    process.exit(2)
  }
  const loaded: { file: string; agg: AggState }[] = []
  for (const file of positionals) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Saved
      if (saved.agg && saved.agg.schemaVersion === 1 && saved.agg.matches > 0) loaded.push({ file, agg: saved.agg })
      else console.error(`Ignorado (vazio ou formato antigo): ${file}`)
    } catch {
      console.error(`Ignorado (não consegui ler): ${file}`)
    }
  }
  if (loaded.length === 0) {
    console.error('Nenhuma coleta utilizável.')
    process.exit(1)
  }
  // Usa o patch mais frequente entre as coletas (normalmente é o mesmo em todas).
  const counts = new Map<string, number>()
  for (const l of loaded) counts.set(l.agg.patch, (counts.get(l.agg.patch) ?? 0) + l.agg.matches)
  const patch = [...counts].sort((a, b) => b[1] - a[1])[0][0]
  loaded.sort((a, b) => (a.agg.patch === patch ? 0 : 1) - (b.agg.patch === patch ? 0 : 1))
  const { merged, used, skipped } = mergeStates(loaded.map((l) => l.agg))
  for (const i of skipped) console.error(`Patch diferente (${loaded[i].agg.patch} ≠ ${patch}), ignorado: ${loaded[i].file}`)
  const regions = [...new Set(used.map((i) => regionOf(loaded[i].file)))]
  const dataset = validateDataset(
    finalize(merged, {
      minGames: Number(v['min-games']),
      minMatchupGames: Number(v['min-matchup-games']),
      minBuildSamples: Number(v['min-build-samples']),
      source: `Riot Match-v5 (${regions.join('+')}), ${merged.matches} partidas`,
      generatedAt: new Date().toISOString(),
      regions
    })
  )
  void writeJsonAtomic(String(v.out), dataset).then(() => {
    console.error(`Gerado ${v.out}: ${Object.keys(dataset.champions).length} campeões, ${merged.matches} partidas, servidores: ${regions.join(', ')}`)
  })
}

main()
