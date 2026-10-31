// tools/check-meta.ts
// Confere um meta.json antes de publicar: valida o formato e mostra o que ele tem.
//   pnpm meta:check -- meta.json            (mostra o resumo)
//   pnpm meta:check -- meta.json --strict   (falha se estiver pobre demais para publicar)
import { readFileSync } from 'node:fs'
import { validateDataset } from '../src/main/data/meta'
import { ROLES } from '../src/shared/dataTypes'

const args = process.argv.slice(2).filter((a) => a !== '--')
const file = args.find((a) => !a.startsWith('--')) ?? 'meta.json'
const strict = args.includes('--strict')

const ds = validateDataset(JSON.parse(readFileSync(file, 'utf8')))
let rows = 0
let builds = 0
let withRunes = 0
let withSpells = 0
let matchups = 0
let games = 0
for (const c of Object.values(ds.champions)) {
  for (const r of ROLES) {
    const m = c.roles[r]
    if (!m) continue
    rows++
    games += m.games
    matchups += Object.keys(m.matchups).length
    if (m.build) {
      builds++
      if (m.build.runes) withRunes++
      if (m.build.spells) withSpells++
    }
  }
}
const matches = Math.round(games / 10)
console.log(`Patch ${ds.patch}, ${Object.keys(ds.champions).length} campeões, ${rows} campeão/rota, ~${matches} partidas`)
console.log(`Builds: ${builds} (com runas: ${withRunes}, com feitiços: ${withSpells}); confrontos: ${matchups}`)

if (strict) {
  const problems: string[] = []
  if (ds.isSample) problems.push('o arquivo é de amostra')
  if (Object.keys(ds.champions).length < 40) problems.push('menos de 40 campeões')
  if (builds < 30) problems.push('menos de 30 builds (as timelines falharam ou foram poucas partidas)')
  if (matches < 300) problems.push('menos de 300 partidas')
  if (problems.length) {
    console.error('Dados fracos demais para publicar: ' + problems.join('; '))
    process.exit(1)
  }
}
