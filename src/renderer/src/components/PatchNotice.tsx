import { useEffect, useState } from 'react'
import type { PatchChange, PatchChanges } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { pct, ROLE_SHORT } from '../lib/format'
import { ChampionIcon, useChampionName } from './Icons'

const SHOWN = 3

function itemName(items: Record<string, { name: string }> | undefined, id: number): string {
  return items?.[String(id)]?.name ?? `item ${id}`
}

function ChangeRow({ c }: { c: PatchChange }) {
  const name = useChampionName(c.championId)
  const items = useApp((s) => s.catalog?.items)
  const up = c.winrateTo >= c.winrateFrom
  return (
    <li className="flex items-center gap-2 py-1">
      <ChampionIcon id={c.championId} size={28} />
      <span className="min-w-0 flex-1 truncate text-sm text-snow">
        {name} <span className="text-xs text-mist">{ROLE_SHORT[c.role]}</span>
      </span>
      <span className="text-xs text-mist">
        {c.fromTier !== c.toTier ? (
          <>
            Tier {c.fromTier} → <span className={up ? 'text-ally' : 'text-enemy'}>{c.toTier}</span>
          </>
        ) : (
          <>Tier {c.toTier}</>
        )}
        {' · '}
        {pct(c.winrateFrom)} → <span className={up ? 'text-ally' : 'text-enemy'}>{pct(c.winrateTo)}</span>
        {c.coreFrom !== undefined && c.coreTo !== undefined && (
          <>
            {' · '}1º item: {itemName(items, c.coreFrom)} → {itemName(items, c.coreTo)}
          </>
        )}
      </span>
    </li>
  )
}

/** Aviso (uma vez por patch) do que mudou para os campeões das suas Pools. */
export function PatchNotice() {
  const metaInfo = useApp((s) => s.metaInfo)
  const ready = useApp((s) => s.ready)
  const hasProfiles = useApp((s) => s.profiles.length > 0)
  const [notice, setNotice] = useState<PatchChanges | null>(null)
  const [all, setAll] = useState(false)
  const patch = metaInfo?.patch ?? ''

  useEffect(() => {
    if (!ready || !hasProfiles || !patch) return
    let cancelled = false
    window.api
      .getPatchChanges()
      .then((n) => !cancelled && setNotice(n))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [ready, hasProfiles, patch])

  if (!notice) return null
  const rows = all ? notice.changes : notice.changes.slice(0, SHOWN)

  function dismiss(): void {
    setNotice(null)
    void window.api.ackPatchChanges().catch(() => undefined)
  }

  return (
    <section role="status" aria-label="Mudanças do patch" className="border-b border-gold/30 bg-gold/10 px-5 py-2 max-[900px]:px-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gold">
          Patch {notice.toPatch}: {notice.changes.length === 1 ? 'mudou 1 campeão' : `mudaram ${notice.changes.length} campeões`} das suas Pools desde o {notice.fromPatch}
        </p>
        <button type="button" className="shrink-0 text-sm text-gold underline underline-offset-4 hover:text-snow" onClick={dismiss}>
          Entendi
        </button>
      </div>
      <ul className="mt-1 divide-y divide-gold/20">
        {rows.map((c) => (
          <ChangeRow key={`${c.championId}-${c.role}`} c={c} />
        ))}
      </ul>
      {notice.changes.length > SHOWN && (
        <button type="button" className="mt-1 text-xs text-mist underline underline-offset-4 hover:text-snow" onClick={() => setAll((v) => !v)}>
          {all ? 'Mostrar menos' : `Ver todos (${notice.changes.length})`}
        </button>
      )}
    </section>
  )
}
