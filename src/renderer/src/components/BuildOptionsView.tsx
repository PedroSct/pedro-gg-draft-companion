import { useEffect, useRef, useState } from 'react'
import type { BuildOption, ChampionBuild, SkillKey, SpellInfo } from '../../../shared/dataTypes'
import { ZERO_SELECTION, type BuildSelection } from '../../../shared/buildSelection'
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
  index: wanted,
  onIndex,
  render
}: {
  label: string
  options: BuildOption<T>[]
  total: number
  index: number
  onIndex: (i: number) => void
  render: (value: T) => React.ReactNode
}) {
  const index = Math.min(wanted, options.length - 1)
  const setIndex = onIndex
  const current = options[index]
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

function ItemOptionRow({
  items,
  o,
  total,
  highlight,
  selected,
  onPick
}: {
  items: number[]
  o: BuildOption<unknown>
  total: number
  highlight?: boolean
  selected?: boolean
  onPick?: () => void
}) {
  const ring = selected ? 'ring-1 ring-gold/60 bg-raised/60' : highlight ? 'bg-ally/10 ring-1 ring-ally/40' : ''
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={!!selected}
        disabled={!onPick}
        onClick={onPick}
        className={`flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg px-2 py-1.5 text-left ${ring} ${onPick ? 'hover:bg-raised/40' : 'cursor-default'}`}
      >
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
      </button>
    </li>
  )
}

function ItemOptions({
  title,
  options,
  total,
  highlightKey,
  index,
  onIndex
}: {
  title: string
  options: BuildOption<number[]>[]
  total: number
  highlightKey?: string
  index: number
  onIndex: (i: number) => void
}) {
  const many = options.length > 1
  return (
    <div>
      <h4 className="mb-1 text-xs text-mist">{title}</h4>
      <ul role="radiogroup" aria-label={title} className="flex flex-col gap-0.5">
        {options.map((o, i) => (
          <ItemOptionRow
            key={i}
            items={o.value}
            o={o}
            total={total}
            highlight={!!highlightKey && o.value.join(',') === highlightKey}
            selected={many && i === Math.min(index, options.length - 1)}
            onPick={many ? () => onIndex(i) : undefined}
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * Build completa. Com `build.options` (dados da 0.5.2) mostra as opções mais jogadas de cada parte, com escolha e
 * winrate; sem elas, mostra a build única de sempre.
 */
/** Abaixo disto as escolhas de itens e habilidades ainda são ruído. */
const LOW_SAMPLE = 40

export function BuildOptionsView({
  build,
  spells,
  highlightCore,
  selection,
  onSelect
}: {
  build: ChampionBuild
  spells: SpellInfo[]
  highlightCore?: number[] | null
  /** opção escolhida de cada parte (controlado pelo pai quando ele precisa saber, ex.: para enviar ao LoL) */
  selection?: BuildSelection
  onSelect?: (s: BuildSelection) => void
}) {
  const o = build.options
  const highlightKey = highlightCore?.join(',')
  const [inner, setInner] = useState<BuildSelection>(ZERO_SELECTION)
  const sel = selection ?? inner
  const touchedCore = useRef(false)
  const [skillIdx, setSkillIdx] = useState(0)
  const choose = (patch: Partial<BuildSelection>): void => {
    const next = { ...sel, ...patch }
    setInner(next)
    onSelect?.(next)
  }

  // Outro campeão/rota (build nova): volta para a opção mais usada.
  useEffect(() => {
    touchedCore.current = false
    setInner(ZERO_SELECTION)
    setSkillIdx(0)
    onSelect?.(ZERO_SELECTION)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build])

  // Se uma construção encaixa melhor no time inimigo, ela já vem marcada (até a pessoa escolher outra).
  useEffect(() => {
    if (!highlightKey || !o?.core || touchedCore.current) return
    const at = o.core.findIndex((c) => c.value.join(',') === highlightKey)
    if (at > 0) {
      const next = { ...sel, core: at }
      setInner(next)
      onSelect?.(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey, build])

  const skillBuild = (v: { priority: SkillKey[]; levels?: SkillKey[] }): ChampionBuild => ({
    skillOrder: v,
    items: { starting: [], boots: [], core: [], situational: [] }
  })

  // Poucas partidas com timeline: as porcentagens de itens e habilidades oscilam muito.
  const lowSample = o !== undefined && o.timeline > 0 && o.timeline < LOW_SAMPLE
  return (
    <>
      {lowSample && (
        <p role="note" className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
          Poucos dados: esta build vem de {o.timeline} {o.timeline === 1 ? 'partida' : 'partidas'}. Itens e habilidades podem não refletir o meta.
        </p>
      )}
      {(build.runes || build.spells || o?.runes || o?.spells) && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm text-mist">Runas e feitiços</h3>
          {o?.runes ? (
            <Choice label="Opções de runas" options={o.runes} total={o.games} index={sel.runes} onIndex={(i) => choose({ runes: i })} render={(v) => <RunesView runes={v} />} />
          ) : (
            build.runes && <RunesView runes={build.runes} />
          )}
          {o?.spells ? (
            <ul role="radiogroup" aria-label="Feitiços" className="flex flex-col gap-1">
              {o.spells.map((s, i) => {
                const many = o.spells!.length > 1
                const on = many && i === Math.min(sel.spells, o.spells!.length - 1)
                return (
                  <li key={i}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!many}
                      onClick={() => choose({ spells: i })}
                      className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1 text-left ${on ? 'bg-raised/60 ring-1 ring-gold/60' : many ? 'hover:bg-raised/40' : 'cursor-default'}`}
                    >
                      <SpellsView spells={s.value} />
                      <Stats games={s.games} wins={s.wins} total={o.games} />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            build.spells && <SpellsView spells={build.spells} />
          )}
        </div>
      )}

      {o?.skills ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm text-mist">Ordem das habilidades</h3>
          <Choice label="Opções de habilidades" options={o.skills} total={o.timeline} index={skillIdx} onIndex={setSkillIdx} render={(v) => <SkillOrder build={skillBuild(v)} spells={spells} hideTitle />} />
        </div>
      ) : (
        build.skillOrder ? (
          <SkillOrder build={build} spells={spells} />
        ) : (
          <p role="note" className="rounded-xl border border-line bg-panel/50 px-3 py-2 text-sm text-mist">
            Ainda sem ordem de habilidades para este campeão: a Riot entrega a sequência de um jeito que o coletor não conseguiu ler.
          </p>
        )
      )}

      <div className="flex flex-col gap-3">
        <h3 className="text-sm text-mist">Itens</h3>
        {o?.starting ? (
          <ItemOptions title="Inicial" options={o.starting} total={o.timeline} index={sel.starting} onIndex={(i) => choose({ starting: i })} />
        ) : (
          <ItemRow title="Inicial" ids={build.items.starting} />
        )}
        {o?.boots ? (
          <ItemOptions title="Botas" options={o.boots.map((b) => ({ ...b, value: [b.value] }))} total={o.timeline} index={sel.boots} onIndex={(i) => choose({ boots: i })} />
        ) : (
          <ItemRow title="Botas" ids={build.items.boots} />
        )}
        {o?.core ? (
          <ItemOptions
            title="Builds principais, na ordem de compra"
            options={o.core}
            total={o.timeline}
            highlightKey={highlightKey}
            index={sel.core}
            onIndex={(i) => {
              touchedCore.current = true
              choose({ core: i })
            }}
          />
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
        {o && <p className="text-[11px] text-dim">Escolha = fatia das partidas do campeão; o segundo número é a taxa de vitória. * = menos de {FEW_GAMES} partidas. A opção marcada é a que “Enviar para o LoL” usa.</p>}
      </div>
    </>
  )
}
