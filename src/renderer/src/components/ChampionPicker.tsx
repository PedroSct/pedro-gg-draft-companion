import { useMemo, useState } from 'react'
import type { Role } from '../../../shared/types'
import { ROLES, type Catalog } from '../../../shared/dataTypes'
import {
  CLASSES,
  CLASS_LABEL,
  STYLES,
  STYLE_LABEL,
  defaultFilter,
  filterChampions,
  positionsOf,
  styleOf,
  type ChampionClass,
  type LaneScope,
  type Style
} from '../../../shared/championMeta'
import { normalize, ROLE_LABEL, ROLE_SHORT } from '../lib/format'
import { btn, chip, input } from '../lib/ui'
import { ChampionIcon } from './Icons'

interface Props {
  catalog: Catalog
  /** rota cuja Pool está em edição */
  role: Role
  inPool: ReadonlySet<number>
  onToggle: (champion: { id: number; key: string }) => void
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}

/**
 * Lista de campeões para montar a Pool.
 * Por padrão mostra só quem joga na rota em edição; "Todos" libera o resto.
 * Dá para combinar rota, classe (Data Dragon) e função (estilo de jogo) com a busca por nome.
 */
export function ChampionPicker({ catalog, role, inPool, onToggle }: Props) {
  const [scope, setScope] = useState<LaneScope>('lane')
  const [lanes, setLanes] = useState<Role[]>([])
  const [classes, setClasses] = useState<ChampionClass[]>([])
  const [styles, setStyles] = useState<Style[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filter = { ...defaultFilter(role), scope, lanes, classes, styles, query: normalize(query) }
  const activeExtras = (scope === 'all' ? lanes.length : 0) + classes.length + styles.length + (query ? 1 : 0)

  const results = useMemo(
    () =>
      filterChampions(catalog.champions, filter, (c, q) => normalize(c.name).includes(q) || normalize(c.key).includes(q)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, scope, role, lanes, classes, styles, query]
  )

  function clear(): void {
    setLanes([])
    setClasses([])
    setStyles([])
    setQuery('')
  }

  const tip = (key: string, name: string): string => {
    const pos = positionsOf(key)
    const st = styleOf(key)
    return [name, pos ? pos.map((r) => ROLE_SHORT[r]).join('/') : null, st ? STYLE_LABEL[st] : null].filter(Boolean).join(' · ')
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2">
        <label htmlFor="search" className="sr-only">
          Buscar campeão
        </label>
        <input id="search" className={input} placeholder="Buscar campeão" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex shrink-0" role="group" aria-label="Quais campeões mostrar">
          {(
            [
              ['lane', `Só de ${ROLE_LABEL[role]}`],
              ['all', 'Todos']
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={`border px-3 py-1.5 text-sm first:rounded-l-lg last:rounded-r-lg ${
                scope === value ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line bg-panel text-mist hover:text-snow'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`${btn} shrink-0 ${activeExtras - (query ? 1 : 0) > 0 ? 'border-gold/60 text-gold' : ''}`}
        >
          Filtros{activeExtras - (query ? 1 : 0) > 0 ? ` (${activeExtras - (query ? 1 : 0)})` : ''}
        </button>
      </div>

      {open && (
      <div className="mt-2.5 flex flex-col gap-1.5">
        {scope === 'all' && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por rota">
            <span className="w-14 text-xs text-dim">Rota</span>
            {ROLES.map((r) => (
              <button key={r} type="button" aria-pressed={lanes.includes(r)} className={chip(lanes.includes(r))} onClick={() => setLanes(toggle(lanes, r))}>
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por classe">
          <span className="w-14 text-xs text-dim">Classe</span>
          {CLASSES.map((c) => (
            <button key={c} type="button" aria-pressed={classes.includes(c)} className={chip(classes.includes(c))} onClick={() => setClasses(toggle(classes, c))}>
              {CLASS_LABEL[c]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por função">
          <span className="w-14 text-xs text-dim">Função</span>
          {STYLES.map((s) => (
            <button key={s} type="button" aria-pressed={styles.includes(s)} className={chip(styles.includes(s))} onClick={() => setStyles(toggle(styles, s))}>
              {STYLE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-mist">
        <span role="status">
          {results.length} {results.length === 1 ? 'campeão' : 'campeões'}
        </span>
        {scope === 'lane' && <span className="text-dim">Quer outro? Escolha “Todos”.</span>}
        {activeExtras > 0 && (
          <button type="button" className={`${btn} ml-auto px-2 py-0.5 text-xs`} onClick={clear}>
            Limpar filtros
          </button>
        )}
      </div>

      <ul className="mt-2 grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(64px,1fr))] content-start gap-1.5 overflow-y-auto pr-1" aria-label="Campeões">
        {results.map((c) => {
          const on = inPool.has(c.id)
          return (
            <li key={c.id}>
              <button
                type="button"
                title={tip(c.key, c.name)}
                aria-pressed={on}
                aria-label={c.name}
                onClick={() => onToggle({ id: c.id, key: c.key })}
                className={`flex w-full flex-col items-center gap-0.5 rounded-xl p-1 transition-colors ${on ? 'bg-gold/90 text-night' : 'hover:bg-raised'}`}
              >
                <ChampionIcon id={c.id} size={44} />
                <span className="w-full truncate text-center text-[11px] leading-tight">{c.name}</span>
              </button>
            </li>
          )
        })}
        {results.length === 0 && (
          <li className="col-span-full border border-dashed border-line p-4 text-mist">
            Nenhum campeão com esses filtros.{' '}
            {scope === 'lane' && 'Escolha “Todos” para ver os campeões de outras rotas.'}
          </li>
        )}
      </ul>
    </div>
  )
}
