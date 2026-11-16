import { useMemo } from 'react'
import { ROLE_PT, type PgSummary } from '../../../shared/postgame'
import { AREA_WINDOW, summarizeProgress, type AreaAggregate, type ChampionLine, type Observation } from '../../../shared/progress'
import { GrowBar, LineChart, Radar, gradeColor } from './charts'
import { ChampionIcon, useChampionName } from './Icons'

const pct = (v: number): string => `${Math.round(v * 100)}%`

const LEVEL: Record<Observation['level'], { border: string; text: string }> = {
  good: { border: 'border-good', text: 'text-good' },
  warn: { border: 'border-gold', text: 'text-gold' },
  info: { border: 'border-mist/50', text: 'text-mist' }
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-line px-5 py-4 [&:not(:last-child)]:border-r">
      <div className="text-xs font-medium uppercase tracking-wider text-dim">{label}</div>
      <div className="num mt-1 text-3xl font-semibold leading-tight text-snow">{value}</div>
      {hint && <div className="text-xs text-dim">{hint}</div>}
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
      <td className={`num px-2 text-right ${c.winrate >= 0.5 ? 'text-good' : 'text-enemy'}`}>{pct(c.winrate)}</td>
      <td className="num px-2 text-right">{c.avgScore}</td>
      <td className="num pl-2 text-right">{c.kda.toFixed(1)}</td>
    </tr>
  )
}


const LEVEL_TEXT = { strong: 'Forte', ok: 'Regular', weak: 'A melhorar' } as const
const levelColor = (score: number): string => (score >= 70 ? 'var(--color-ally)' : score >= 45 ? 'var(--color-gold)' : 'var(--color-enemy)')

function AreaRow({ a }: { a: AreaAggregate }) {
  return (
    <li aria-label={`Área ${a.label}`} className="border-b border-line py-3.5">
      <div className="flex items-center gap-3">
        <span className="num grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-lg font-semibold" style={{ color: gradeColor(a.grade), borderColor: gradeColor(a.grade) }} aria-label={`Conceito ${a.grade}`}>
          {a.grade}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-display text-base font-semibold">{a.label}</h3>
            <span className="num text-sm text-mist">{a.avg}/100</span>
            <span className="text-xs" style={{ color: levelColor(a.avg) }}>
              {LEVEL_TEXT[a.level]}
            </span>
            {a.change !== null && a.change !== 0 && (
              <span className={`num text-xs ${a.change > 0 ? 'text-good' : 'text-enemy'}`} title="Últimas 5 partidas contra as 5 anteriores">
                {a.change > 0 ? '▲' : '▼'} {Math.abs(a.change)}
              </span>
            )}
            {a.focus && <span className="rounded-full border border-gold/50 px-2 text-[11px] text-gold">Foque aqui</span>}
          </div>
          <div className="mt-1">
            <GrowBar value={a.avg} color={levelColor(a.avg)} label={`${a.label} ${a.avg}`} />
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-dim">
        {a.detail} · {a.games} {a.games === 1 ? 'partida' : 'partidas'}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm text-snow">
        {a.actions.map((t) => (
          <li key={t}>• {t}</li>
        ))}
      </ul>
    </li>
  )
}

function AreaScores({ areas }: { areas: AreaAggregate[] }) {
  const focus = areas.filter((a) => a.focus)
  return (
    <section aria-label="Pontuação por área" className="">
      <h2 className="font-display text-lg font-semibold">Pontuação por área</h2>
      <p className="mb-3 text-xs text-dim">
        Média das suas últimas {AREA_WINDOW} partidas analisadas. Cada nota compara você com uma referência aproximada para a sua rota (não é a meta oficial).
      </p>
      {areas.length === 0 ? (
        <p className="text-sm text-mist">Com 3 partidas analisadas as notas por área aparecem aqui.</p>
      ) : (
        <div className="grid gap-4 min-[900px]:grid-cols-[300px_1fr] min-[900px]:gap-10">
          <div className="flex flex-col items-center gap-2">
            <Radar items={areas.map((a) => ({ label: a.label, score: a.avg }))} />
            <p className="text-center text-sm text-snow" aria-label="Foco da próxima partida">
              {focus.length ? (
                <>
                  Foco: <strong className="text-gold">{focus.map((f) => f.label).join(' e ')}</strong>
                </>
              ) : (
                'Nenhuma área abaixo do esperado. Busque consistência.'
              )}
            </p>
          </div>
          <ul>
            {areas.map((a) => (
              <AreaRow key={a.key} a={a} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** Evolução a partir das partidas já analisadas: nota ao longo do tempo, campeões e padrões de erro. */
export function ProgressView({ list }: { list: PgSummary[] }) {
  const p = useMemo(() => summarizeProgress(list), [list])

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1" aria-label="Evolução">
      <div className="grid grid-cols-2 rounded-xl border border-line max-[899px]:[&>*]:border-b min-[900px]:grid-cols-4">
        <Tile label="Partidas analisadas" value={String(p.games)} />
        <Tile label="Vitórias" value={p.winrate === null ? '–' : pct(p.winrate)} hint={p.decided ? `${p.wins} de ${p.decided}` : undefined} />
        <Tile label="Nota média" value={String(p.avgScore)} hint={p.scoreChange === null ? undefined : `${p.scoreChange > 0 ? '+' : ''}${p.scoreChange} nas últimas 5`} />
        <Tile label="Mortes por partida" value={p.avgDeaths.toFixed(1)} />
      </div>

      <AreaScores areas={p.areas} />

      <section aria-label="Nota ao longo do tempo" className="">
        <h2 className="mb-3 font-display text-lg font-semibold">Nota ao longo do tempo</h2>
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

      <section aria-label="Padrões e observações" className="">
        <h2 className="mb-3 font-display text-lg font-semibold">O que os números dizem</h2>
        {p.observations.length === 0 ? (
          <p className="text-sm text-mist">{p.games < 5 ? 'Analise pelo menos 5 partidas para ver padrões.' : 'Nenhum padrão forte por enquanto. Continue jogando.'}</p>
        ) : (
          <ul className="space-y-2">
            {p.observations.map((o) => (
              <li key={o.title} className={`border-l-2 px-3 py-2 ${LEVEL[o.level].border}`}>
                <div className={`font-display text-base font-semibold ${LEVEL[o.level].text}`}>{o.title}</div>
                <div className="text-sm text-mist">{o.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 min-[900px]:grid-cols-[1.6fr_1fr]">
        <section aria-label="Desempenho por campeão" className="">
          <h2 className="mb-3 font-display text-lg font-semibold">Por campeão</h2>
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
        <section aria-label="Desempenho por rota" className="">
          <h2 className="mb-3 font-display text-lg font-semibold">Por rota</h2>
          {p.roles.length === 0 ? (
            <p className="text-sm text-mist">Sem rota identificada nas partidas.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {p.roles.map((r) => (
                <li key={r.role} className="flex items-center justify-between gap-2">
                  <span className="text-snow">{ROLE_PT[r.role]}</span>
                  <span className="text-mist">
                    {r.games} {r.games === 1 ? 'jogo' : 'jogos'} · <span className={r.winrate >= 0.5 ? 'text-good' : 'text-enemy'}>{pct(r.winrate)}</span> · nota {r.avgScore}
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
