import { useEffect, useMemo, useState } from 'react'
import type { MetaSynergyRow } from '../../../shared/dataTypes'
import type { Role } from '../../../shared/types'
import { useApp } from '../store/useApp'
import { normalize, pct, ROLE_LABEL, signed } from '../lib/format'
import { input } from '../lib/ui'
import { ChampionIcon, useChampionName } from './Icons'
import { TierBadge } from './TierBadge'

/** Pares de rotas, os mais comuns primeiro. A primeira rota de cada par é a "A" da tabela. */
export const ROLE_PAIRS: readonly (readonly [Role, Role])[] = [
  ['BOTTOM', 'UTILITY'],
  ['JUNGLE', 'MIDDLE'],
  ['TOP', 'MIDDLE'],
  ['TOP', 'JUNGLE'],
  ['JUNGLE', 'UTILITY'],
  ['JUNGLE', 'BOTTOM'],
  ['MIDDLE', 'UTILITY'],
  ['MIDDLE', 'BOTTOM'],
  ['TOP', 'UTILITY'],
  ['TOP', 'BOTTOM']
]

interface Anchor {
  id: number
  role: Role
}

function Pick({ id, onPin, pinned }: { id: number; onPin: () => void; pinned: boolean }) {
  const name = useChampionName(id)
  return (
    <button type="button" onClick={onPin} aria-pressed={pinned} title={`Ver só os combos de ${name}`} className="flex min-w-0 items-center gap-2 rounded-md text-left hover:text-snow">
      <ChampionIcon id={id} size={32} />
      <span className="truncate font-medium">{name}</span>
    </button>
  )
}

function SynergyItem({ row, pair, anchor, onPin }: { row: MetaSynergyRow; pair: readonly [Role, Role]; anchor: Anchor | null; onPin: (a: Anchor) => void }) {
  const nameA = useChampionName(row.aId)
  const nameB = useChampionName(row.bId)
  return (
    <li
      className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_64px_68px_56px] items-center gap-3 border-b border-line px-2.5 py-2 text-sm"
      aria-label={`${nameA} com ${nameB}`}
      title={`${row.games.toLocaleString('pt-BR')} partidas juntos${row.rare ? ' (amostra pequena)' : ''}`}
    >
      <TierBadge tier={row.tier} />
      <Pick id={row.aId} pinned={anchor?.id === row.aId && anchor.role === pair[0]} onPin={() => onPin({ id: row.aId, role: pair[0] })} />
      <Pick id={row.bId} pinned={anchor?.id === row.bId && anchor.role === pair[1]} onPin={() => onPin({ id: row.bId, role: pair[1] })} />
      <span className="num text-right">
        {pct(row.winrate)}
        {row.rare && <span className="text-gold">*</span>}
      </span>
      <span className={`num text-right ${row.synergy >= 0.5 ? 'text-good' : row.synergy <= -0.5 ? 'text-enemy' : 'text-mist'}`}>{signed(row.synergy)} pp</span>
      <span className="num text-right text-dim">{row.games.toLocaleString('pt-BR')}</span>
    </li>
  )
}

/** Aba "Sinergias" do Meta: os melhores combos de cada par de rotas, ou os parceiros de um campeão fixado. */
export function SynergyView() {
  const metaInfo = useApp((s) => s.metaInfo)
  const champById = useApp((s) => s.champById)
  const [pairIdx, setPairIdx] = useState(0)
  const pair = ROLE_PAIRS[pairIdx]
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const [rows, setRows] = useState<MetaSynergyRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    let off = false
    setRows(null)
    void window.api.getMetaSynergies({ roleA: pair[0], roleB: pair[1], anchor: anchor?.id, anchorRole: anchor?.role, limit: anchor ? 40 : 80 }).then((r) => {
      if (!off) setRows(r)
    })
    return () => {
      off = true
    }
  }, [pair, anchor, metaInfo])

  const suggestions = useMemo(() => {
    const q = normalize(query)
    if (!q) return []
    return [...champById.values()].filter((c) => normalize(c.name).includes(q)).slice(0, 6)
  }, [query, champById])

  const pin = (a: Anchor | null): void => {
    setAnchor(a)
    setQuery('')
  }
  const choosePair = (i: number): void => {
    setPairIdx(i)
    setAnchor(null)
  }
  const anchorName = anchor ? (champById.get(anchor.id)?.name ?? `Campeão ${anchor.id}`) : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1" role="tablist" aria-label="Par de rotas">
        {ROLE_PAIRS.map(([a, b], i) => (
          <button
            key={`${a}-${b}`}
            type="button"
            role="tab"
            aria-selected={pairIdx === i}
            onClick={() => choosePair(i)}
            className={`-mb-px border-b-2 py-1.5 text-sm ${pairIdx === i ? 'border-gold text-snow' : 'border-transparent text-mist hover:text-snow'}`}
          >
            {ROLE_LABEL[a]} + {ROLE_LABEL[b]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-56 max-w-full">
          <label htmlFor="syn-search" className="sr-only">
            Fixar um campeão
          </label>
          <input id="syn-search" className={`${input} w-full`} placeholder="Fixar um campeão" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          {suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-line bg-panel shadow-none" role="listbox" aria-label="Campeões encontrados">
              {suggestions.map((c) => (
                <li key={c.id} role="option" aria-selected={false}>
                  <button type="button" onClick={() => pin({ id: c.id, role: pair[0] })} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-raised">
                    <ChampionIcon id={c.id} size={24} />
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {anchor && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-mist">Combos de</span>
            <ChampionIcon id={anchor.id} size={24} />
            <b className="font-semibold">{anchorName}</b>
            <span className="text-mist">como</span>
            <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Rota do campeão fixado">
              {pair.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={anchor.role === r}
                  onClick={() => setAnchor({ id: anchor.id, role: r })}
                  className={`px-2.5 py-1 text-xs ${anchor.role === r ? 'bg-raised text-snow' : 'text-mist hover:text-snow'}`}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <button type="button" className="text-xs text-mist underline hover:text-snow" onClick={() => pin(null)}>
              Limpar
            </button>
          </div>
        )}
        <button type="button" className="text-xs text-mist underline hover:text-snow" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
          Como os combos são calculados
        </button>
      </div>
      {helpOpen && (
        <p role="note" className="max-w-3xl text-xs leading-relaxed text-mist">
          A nota do combo parte da taxa de vitória da dupla e tira a margem de erro, como no tier: poucos jogos encolhem o número para perto de 50%. Pares com menos de 30 jogos não aparecem, e abaixo
          de 100 jogos (*) o tier não passa de B. <b className="font-medium text-snow">Sinergia</b> é o que a dupla rende além da soma dos dois sozinhos, em pontos percentuais (pp): positiva quando um
          melhora o outro, não só quando os dois já são fortes. O dado guarda o aliado sem a rota dele; por isso só entram parceiros que jogam aquela rota em pelo menos metade das partidas.
        </p>
      )}

      <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_64px_68px_56px] gap-x-3 border-b border-line px-2.5 pb-2 text-[11px] text-dim">
        <span>Tier</span>
        <span>{ROLE_LABEL[pair[0]]}</span>
        <span>{ROLE_LABEL[pair[1]]}</span>
        <span className="text-right">Vitórias</span>
        <span className="text-right">Sinergia</span>
        <span className="text-right">Jogos</span>
      </div>
      {rows === null ? (
        <p className="text-mist">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-4 text-mist">Os dados de meta ainda não têm combos suficientes para este par de rotas.</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1" aria-label={`Combos de ${ROLE_LABEL[pair[0]]} + ${ROLE_LABEL[pair[1]]}`}>
          {rows.map((r) => (
            <SynergyItem key={`${r.aId}-${r.bId}`} row={r} pair={pair} anchor={anchor} onPin={pin} />
          ))}
        </ul>
      )}
    </div>
  )
}
