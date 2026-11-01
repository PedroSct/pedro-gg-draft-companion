import { useEffect, useState } from 'react'
import type { BuildOption, ChampionBuild, SkillKey, SpellInfo } from '../../../shared/dataTypes'
import { pct } from '../lib/format'
import { ItemIcon } from './Icons'
import { ItemRow, SituationalItem, SkillOrder } from './BuildParts'
import { RunesView, SpellsView } from './LoadoutView'

/** Poucas partidas: o número oscila muito, então avisa. */
const FEW_GAMES = 10

function Stats({ games, wins, total }: { games: number; wins: number; total: number }) {
  const few = games < FEW_GAMES
  return (
    <span className="num flex shrink-0 items-center gap-3 text-sm" title={`${games} partidas${few ? ' (amostra pequena)' : ''}`}>
      <span className="text-mist">
        <span className="text-snow">{total > 0 ? pct(games / total) : '—'}</span> escolha
      </span>
      <span className={games > 0 && wins / games >= 0.5 ? 'text-ally' : 'text-enemy'}>{games > 0 ? pct(wins / games) : '—'}</span>
      <span className={`w-14 text-right text-xs ${few ? 'text-gold' : 'text-dim'}`}>{games.toLocaleString('pt-BR')}{few ? '*' : ''}</span>
    </span>
  )
}

/** Escolha entre as opções (como as abas de build do OP.GG): mostra só a selecionada. */
function Choice<T>({
  label,
  options,
  total,
  render
}: {
  label: string
  options: BuildOption<T>[]
  total: number
  render: (value: T) => React.ReactNode
}) {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [options])
  const current = options[Math.min(index, options.length - 1)]
  return (
    <div className="flex flex-col gap-2">
      {options.length > 1 && (
        <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
          {options.map((o, i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === index}
              onClick={() => setIndex(i)}
              className={`num rounded-lg border px-2.5 py-1 text-xs ${i === index ? 'border-gold/60 bg-raised text-gold' : 'border-line text-mist hover:text-snow'}`}
            >
              Opção {i + 1} · {total > 0 ? pct(o.games / total) : '—'} · {o.games > 0 ? pct(o.wins / o.games) : '—'}
            </button>
          ))}
        </div>
      )}
      {render(current.value)}
      {options.length === 1 && <Stats games={current.games} wins={current.wins} total={total} />}
    </div>
  )
}

function ItemOptionRow({ items, o, total, highlight }: { items: number[]; o: BuildOption<unknown>; total: number; highlight?: boolean }) {
  return (
    <li className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg px-2 py-1.5 ${highlight ? 'bg-ally/10 ring-1 ring-ally/40' : ''}`}>
      <span className="flex items-center gap-1">
        {items.map((id, k) => (
          <span key={`${id}-${k}`} className="flex items-center gap-1">
            {k > 0 && (
              <span className="text-dim" aria-hidden="true">
                ›
              </span>
            )}
            <ItemIcon id={id} size={34} />
          </span>
        ))}
        {highlight && <span className="ml-2 rounded-full bg-ally/15 px-2 py-0.5 text-xs text-ally">encaixa melhor agora</span>}
      </span>
      <Stats games={o.games} wins={o.wins} total={total} />
    </li>
  )
}

function ItemOptions({ title, options, total, highlightKey }: { title: string; options: BuildOption<number[]>[]; total: number; highlightKey?: string }) {
  return (
    <div>
      <h4 className="mb-1 text-xs text-mist">{title}</h4>
      <ul className="flex flex-col gap-0.5">
        {options.map((o, i) => (
          <ItemOptionRow key={i} items={o.value} o={o} total={total} highlight={!!highlightKey && o.value.join(',') === highlightKey} />
        ))}
      </ul>
    </div>
  )
}

/**
 * Build completa. Com `build.options` (dados da 0.5.2) mostra as opções mais jogadas de cada parte, com escolha e
 * winrate; sem elas, mostra a build única de sempre.
 */
export function BuildOptionsView({ build, spells, highlightCore }: { build: ChampionBuild; spells: SpellInfo[]; highlightCore?: number[] | null }) {
  const o = build.options
  const highlightKey = highlightCore?.join(',')

  const skillBuild = (v: { priority: SkillKey[]; levels?: SkillKey[] }): ChampionBuild => ({
    skillOrder: v,
    items: { starting: [], boots: [], core: [], situational: [] }
  })

  return (
    <>
      {(build.runes || build.spells || o?.runes || o?.spells) && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm text-mist">Runas e feitiços</h3>
          {o?.runes ? (
            <Choice label="Opções de runas" options={o.runes} total={o.games} render={(v) => <RunesView runes={v} />} />
          ) : (
            build.runes && <RunesView runes={build.runes} />
          )}
          {o?.spells ? (
            <ul className="flex flex-col gap-1" aria-label="Feitiços">
              {o.spells.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <SpellsView spells={s.value} />
                  <Stats games={s.games} wins={s.wins} total={o.games} />
                </li>
              ))}
            </ul>
          ) : (
            build.spells && <SpellsView spells={build.spells} />
          )}
        </div>
      )}

      {o?.skills ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm text-mist">Ordem das habilidades</h3>
          <Choice label="Opções de habilidades" options={o.skills} total={o.timeline} render={(v) => <SkillOrder build={skillBuild(v)} spells={spells} hideTitle />} />
        </div>
      ) : (
        build.skillOrder && <SkillOrder build={build} spells={spells} />
      )}

      <div className="flex flex-col gap-3">
        <h3 className="text-sm text-mist">Itens</h3>
        {o?.starting ? (
          <ItemOptions title="Inicial" options={o.starting} total={o.timeline} />
        ) : (
          <ItemRow title="Inicial" ids={build.items.starting} />
        )}
        {o?.boots ? (
          <ItemOptions title="Botas" options={o.boots.map((b) => ({ ...b, value: [b.value] }))} total={o.timeline} />
        ) : (
          <ItemRow title="Botas" ids={build.items.boots} />
        )}
        {o?.core ? (
          <ItemOptions title="Builds principais, na ordem de compra" options={o.core} total={o.timeline} highlightKey={highlightKey} />
        ) : (
          <ItemRow title="Principais, na ordem de compra" ids={build.items.core} chain />
        )}
        {build.items.situational.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-xs text-mist">Situacionais</h4>
            <ul className="flex flex-col gap-2">
              {build.items.situational.map((s) => (
                <SituationalItem key={s.itemId} id={s.itemId} when={s.when} />
              ))}
            </ul>
          </div>
        )}
        {o && <p className="text-[11px] text-dim">Escolha = fatia das partidas do campeão; o segundo número é a taxa de vitória. * = menos de {FEW_GAMES} partidas.</p>}
      </div>
    </>
  )
}
