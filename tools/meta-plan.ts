// tools/meta-plan.ts
// Agrupa os servidores pedidos por "cluster" da Riot e imprime a matriz do workflow (JSON numa linha).
// A chave tem limite por cluster (americas, europe, asia, sea), então servidores do mesmo cluster rodam
// em sequência no mesmo job e clusters diferentes rodam em paralelo.
//   pnpm -s meta:plan --platforms br1,na1,euw1,kr
import { parseArgs } from 'node:util'
import { REGION_OF_PLATFORM } from './meta/riot'

const { values: v } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { platforms: { type: 'string', default: 'br1' } }
})

const wanted = [...new Set(String(v.platforms).split(/[\s,]+/).map((p) => p.trim().toLowerCase()).filter(Boolean))]
const unknown = wanted.filter((p) => !REGION_OF_PLATFORM[p])
if (unknown.length || wanted.length === 0) {
  console.error(`Servidor desconhecido: ${unknown.join(', ') || '(nenhum informado)'}. Válidos: ${Object.keys(REGION_OF_PLATFORM).join(', ')}`)
  process.exit(1)
}
const byRegion = new Map<string, string[]>()
for (const p of wanted) byRegion.set(REGION_OF_PLATFORM[p], [...(byRegion.get(REGION_OF_PLATFORM[p]) ?? []), p])
console.log(JSON.stringify({ include: [...byRegion].map(([region, platforms]) => ({ region, platforms: platforms.join(' ') })) }))
