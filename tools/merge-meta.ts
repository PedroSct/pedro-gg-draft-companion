// tools/merge-meta.ts
// Junta as coletas de vários servidores (arquivos state-v3-<plataforma>-<patch>.json) em um único meta.json.
//
//   pnpm meta:merge --out meta.json states/state-v2-br1-16.21.json states/state-v2-kr-16.21.json
//
// As contagens são somadas (um servidor com mais partidas pesa mais). Coletas de outro patch são ignoradas.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { validateDataset } from '../src/main/data/meta'
import { writeJsonAtomic } from '../src/main/store/fsJson'
import { choosePatch, finalize, mergeStates, MIN_PATCH_MATCHES, type AggState } from './meta/aggregate'

const { values: v, positionals } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'meta.json' },
    'min-games': { type: 'string', default: '30' },
    'min-matchup-games': { type: 'string', default: '3' },
    'min-pair-games': { type: 'string', default: '6' },
    'per-region': { type: 'boolean', default: false },
    'min-build-samples': { type: 'string', default: '15' },
    'min-patch-matches': { type: 'string', default: String(MIN_PATCH_MATCHES) }
  }
})

interface Saved {
  agg?: AggState
}

function regionOf(file: string): string {
  return /state-v\d+-([a-z0-9]+)-/.exec(file)?.[1] ?? 'desconhecido'
}

function main(): void {
  if (positionals.length === 0) {
    console.error('Uso: pnpm meta:merge --out meta.json <state-v3-*.json>...')
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
  // Usa o patch mais novo que já tem partidas suficientes (o antigo não segura o meta só por ter mais partidas acumuladas).
  const patch = choosePatch(loaded.map((l) => ({ patch: l.agg.patch, matches: l.agg.matches })), Number(v['min-patch-matches']))
  console.error(`Patch do meta: ${patch}`)
  loaded.sort((a, b) => (a.agg.patch === patch ? 0 : 1) - (b.agg.patch === patch ? 0 : 1))
  const { merged, used, skipped } = mergeStates(loaded.map((l) => l.agg))
  for (const i of skipped) console.error(`Patch diferente (${loaded[i].agg.patch} ≠ ${patch}), ignorado: ${loaded[i].file}`)
  const regions = [...new Set(used.map((i) => regionOf(loaded[i].file)))]
  const options = {
    minGames: Number(v['min-games']),
    minMatchupGames: Number(v['min-matchup-games']),
    minPairGames: Number(v['min-pair-games']),
    minBuildSamples: Number(v['min-build-samples'])
  }
  const out = String(v.out)
  const dataset = validateDataset(
    finalize(merged, {
      ...options,
      source: `Riot Match-v5 (${regions.join('+')}), ${merged.matches} partidas`,
      generatedAt: new Date().toISOString(),
      regions
    })
  )
  const writes: Promise<void>[] = [writeJsonAtomic(out, dataset)]
  // Partidas reservadas para teste (não entram no meta): servem ao `pnpm meta:backtest`.
  if (merged.holdout?.length) {
    writes.push(writeJsonAtomic(path.join(path.dirname(out), 'holdout.json'), { patch: merged.patch, matches: merged.holdout }))
    console.error(`Gerado holdout.json: ${merged.holdout.length} partidas reservadas para teste`)
  }
  // Diagnóstico das habilidades recusadas/curtas (amostras reais da Riot): fica público na branch data para ajustar o leitor.
  const rejects = Object.entries(merged.skillRejects ?? {}).filter(([, r]) => r.n >= 20).sort((a, b) => b[1].n - a[1].n).slice(0, 60)
  writes.push(writeJsonAtomic(path.join(path.dirname(out), 'skill-diagnostics.json'), { patch: merged.patch, generatedAt: new Date().toISOString(), rejects: Object.fromEntries(rejects) }))
  console.error(`Gerado ${out}: ${Object.keys(dataset.champions).length} campeões, ${merged.matches} partidas, servidores: ${regions.join(', ')}`)

  // Um arquivo por servidor (meta-br1.json...), para o app poder escolher entre "Global" e um servidor.
  if (v['per-region']) {
    for (const i of used) {
      const region = regionOf(loaded[i].file)
      const one = loaded[i].agg
      const file = path.join(path.dirname(out), `meta-${region}.json`)
      const ds = validateDataset(
        finalize(one, {
          ...options,
          source: `Riot Match-v5 (${region}), ${one.matches} partidas`,
          generatedAt: new Date().toISOString(),
          regions: [region]
        })
      )
      writes.push(writeJsonAtomic(file, ds))
      console.error(`Gerado ${file}: ${Object.keys(ds.champions).length} campeões, ${one.matches} partidas`)
    }
  }
  void Promise.all(writes)
}

main()
