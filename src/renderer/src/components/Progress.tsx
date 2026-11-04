import { useMemo } from 'react'
import { ROLE_PT, type PgSummary } from '../../../shared/postgame'
import { summarizeProgress, type ChampionLine, type Observation } from '../../../shared/progress'
import { LineChart } from './charts'
import { ChampionIcon, useChampionName } from './Icons'

const pct = (v: number): string => `${Math.round(v * 100)}%`

const LEVEL: Record<Observation['level'], { border: string; text: string }> = {
  good: { border: 'border-ally', text: 'text-ally' },
  warn: { border: 'border-gold', text: 'text-gold' },
  info: { border: 'border-mist/50', text: 'text-mist' }
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-line bg-panel/70 px-3 py-2">
      <div className="text-xs text-mist">{label}</div>
      <div className="num text-2xl font-semibold text-snow">{value}</div>
      {hint && <div className="text-[11px] text-dim">{hint}</div>}
    </div>
  )
}

function ChampRow({ c }: { c: ChampionLine }) {
  const name = useChampionName(c.championId)
  return (
    <tr className="border-t border-line/60">
      <td className="py-1.5 pr-2">
        <span className="flex items-center gap-2">
          <ChampionIcon id={c.championId} size={28} />
          <span className="truncate text-snow">{name || 'Campeão'}</span>
        </span>
      </td>
      <td className="num px-2 text-right">{c.games}</td>
      <td className={`num px-2 text-right ${c.winrate >= 0.5 ? 'text-ally' : 'text-enemy'}`}>{pct(c.winrate)}</td>
      <td className="num px-2 text-right">{c.avgScore}</td>
      <td className="num pl-2 text-right">{c.kda.toFixed(1)}</td>
    </tr>
  )
}

/** Evolução a partir das partidas já analisadas: nota ao longo do tempo, campeões e padrões de erro. */
export function ProgressView({ list }: { list: PgSummary[] }) {
  const p = useMemo(() => summarizeProgress(list), [list])

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1" aria-label="Evolução">
      <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
        <Tile label="Partidas analisadas" value={String(p.games)} />
        <Tile label="Vitórias" value={p.winrate === null ? '–' : pct(p.winrate)} hint={p.decided ? `${p.wins} de ${p.decided}` : undefined} />
        <Tile label="Nota média" value={String(p.avgScore)} hint={p.scoreChange === null ? undefined : `${p.scoreChange > 0 ? '+' : ''}${p.scoreChange} nas últimas 5`} />
        <Tile label="Mortes por partida" value={p.avgDeaths.toFixed(1)} />
      </div>

      <section aria-label="Nota ao longo do tempo" className="border border-line bg-panel/70 p-3">
        <h2 className="mb-2 font-display text-lg font-semibold">Nota ao longo do tempo</h2>
        {p.trend.length >= 3 ? (
          <LineChart
            xs={p.trend.map((_, i) => i + 1)}
            series={[{ name: 'Nota', color: 'var(--color-gold)', values: p.trend.map((t) => t.score) }]}
            xLabel={(x) => `#${x}`}
            width={1100}
            height={210}
            ariaLabel="Nota de cada partida, da mais antiga para a mais recente"
          />
        ) : (
          <p className="text-sm text-mist">Com 3 partidas analisadas o gráfico aparece aqui.</p>
        )}
      </section>

      <section aria-label="Padrões e observações" className="border border-line bg-panel/70 p-3">
        <h2 className="mb-2 font-display text-lg font-semibold">O que os números dizem</h2>
        {p.observations.length === 0 ? (
          <p className="text-sm text-mist">{p.games < 5 ? 'Analise pelo menos 5 partidas para ver padrões.' : 'Nenhum padrão forte por enquanto. Continue jogando.'}</p>
        ) : (
          <ul className="space-y-2">
            {p.observations.map((o) => (
              <li key={o.title} className={`border-l-2 bg-panel/80 px-3 py-2 ${LEVEL[o.level].border}`}>
                <div className={`font-display text-base font-semibold ${LEVEL[o.level].text}`}>{o.title}</div>
                <div className="text-sm text-mist">{o.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 min-[900px]:grid-cols-[1.6fr_1fr]">
        <section aria-label="Desempenho por campeão" className="border border-line bg-panel/70 p-3">
          <h2 className="mb-2 font-display text-lg font-semibold">Por campeão</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-mist">
              <tr>
                <th className="text-left font-normal">Campeão</th>
                <th className="px-2 text-right font-normal">Jogos</th>
                <th className="px-2 text-right font-normal">Vitórias</th>
                <th className="px-2 text-right font-normal">Nota</th>
                <th className="pl-2 text-right font-normal">KDA</th>
              </tr>
            </thead>
            <tbody>
              {p.champions.slice(0, 10).map((c) => (
                <ChampRow key={c.championId} c={c} />
              ))}
            </tbody>
          </table>
        </section>
        <section aria-label="Desempenho por rota" className="border border-line bg-panel/70 p-3">
          <h2 className="mb-2 font-display text-lg font-semibold">Por rota</h2>
          {p.roles.length === 0 ? (
            <p className="text-sm text-mist">Sem rota identificada nas partidas.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {p.roles.map((r) => (
                <li key={r.role} className="flex items-center justify-between gap-2">
                  <span className="text-snow">{ROLE_PT[r.role]}</span>
                  <span className="text-mist">
                    {r.games} {r.games === 1 ? 'jogo' : 'jogos'} · <span className={r.winrate >= 0.5 ? 'text-ally' : 'text-enemy'}>{pct(r.winrate)}</span> · nota {r.avgScore}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
