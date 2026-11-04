import { useEffect, useState } from 'react'
import type { MetaCounter } from '../../../shared/dataTypes'
import { selectActiveProfile, useApp } from '../store/useApp'
import { pct, ROLE_SHORT } from '../lib/format'
import { btn } from '../lib/ui'
import { ChampionIcon, useChampionName } from './Icons'

function Row({ c, canAdd }: { c: MetaCounter; canAdd: boolean }) {
  const name = useChampionName(c.championId)
  const enemy = useChampionName(c.enemyId)
  const key = useApp((s) => s.champById.get(c.championId)?.key)
  const owner = useApp(selectActiveProfile)
  const saveProfile = useApp((s) => s.saveProfile)
  const [added, setAdded] = useState(false)

  async function add(): Promise<void> {
    if (!owner || !key) return
    const list = owner.pool[c.role] ?? []
    if (list.some((e) => e.championId === c.championId)) return
    await saveProfile({
      ...owner,
      pool: { ...owner.pool, [c.role]: [...list, { championId: c.championId, championKey: key, comfort: 1 }] }
    })
    setAdded(true)
  }

  return (
    <li className="flex items-center gap-3 py-2">
      <ChampionIcon id={c.championId} size={36} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-snow">{name}</div>
        <div className="text-xs text-mist">
          Vence {pct(c.winrate)} contra {enemy} ({c.games} jogos)
        </div>
      </div>
      {canAdd && (
        <button type="button" className={btn} disabled={added || !key} onClick={() => void add()} aria-label={`Adicionar ${name} à Pool`}>
          {added ? 'Na Pool' : 'Adicionar à Pool'}
        </button>
      )}
    </li>
  )
}

/** Picks do meta que ainda não estão na sua Pool e vencem bem o inimigo da sua rota. */
export function MetaCounters() {
  const draft = useApp((s) => s.draft)
  const owner = useApp(selectActiveProfile)
  const [items, setItems] = useState<MetaCounter[]>([])
  const [open, setOpen] = useState(true)

  const signature = draft
    ? [
        draft.phase,
        draft.localRole ?? '',
        draft.bans.allies.join(','),
        draft.bans.enemies.join(','),
        draft.allies.map((p) => `${p.cellId}:${p.championId}:${p.status}:${p.role ?? ''}`).join('|'),
        draft.enemies.map((p) => `${p.championId}:${p.status}`).join('|')
      ].join('#')
    : ''
  const profileId = owner?.id
  const poolSize = owner && draft?.localRole ? (owner.pool[draft.localRole]?.length ?? 0) : 0

  useEffect(() => {
    if (!signature) {
      setItems([])
      return
    }
    let cancelled = false
    window.api
      .getMetaCounters({ profileId })
      .then((r) => !cancelled && setItems(r))
      .catch(() => !cancelled && setItems([]))
    return () => {
      cancelled = true
    }
  }, [signature, profileId, poolSize])

  if (items.length === 0 || !draft?.localRole) return null

  return (
    <section aria-label="Counters do meta" className="border border-line bg-panel/70 px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm text-snow"
      >
        <span>
          Counters do meta em {ROLE_SHORT[draft.localRole]} <span className="text-xs text-mist">(fora da sua Pool)</span>
        </span>
        <span className="text-xs text-mist">{open ? 'Ocultar' : `Mostrar (${items.length})`}</span>
      </button>
      {open && (
        <ul className="mt-1 divide-y divide-line/60">
          {items.map((c) => (
            <Row key={c.championId} c={c} canAdd={owner !== null} />
          ))}
        </ul>
      )}
    </section>
  )
}
