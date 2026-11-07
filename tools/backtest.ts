// tools/backtest.ts
//   pnpm meta:backtest --meta meta.json --holdout holdout.json
// Baixe os dois arquivos da branch "data" do repositório (o holdout.json só existe depois da primeira coleta feita
// com a versão 0.8.2 ou mais nova).
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { validateDataset } from '../src/main/data/meta'
import { formatBacktest, runBacktest } from './meta/backtest'
import type { HoldoutMatch } from './meta/aggregate'

const { values: v } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    meta: { type: 'string', default: 'meta.json' },
    holdout: { type: 'string', default: 'holdout.json' },
    limit: { type: 'string', default: '0' }
  }
})

const dataset = validateDataset(JSON.parse(readFileSync(String(v.meta), 'utf8')))
const hold = JSON.parse(readFileSync(String(v.holdout), 'utf8')) as { patch?: string; matches?: HoldoutMatch[] }
if (hold.patch !== dataset.patch) console.error(`Aviso: o patch do holdout (${hold.patch}) é diferente do meta (${dataset.patch}).`)
let matches = hold.matches ?? []
if (Number(v.limit) > 0) matches = matches.slice(0, Number(v.limit))
if (matches.length < 200) console.error(`Aviso: só ${matches.length} partidas de teste; o resultado vai ser muito impreciso.`)
console.log(formatBacktest(runBacktest(dataset, matches), matches.length, dataset.patch))
