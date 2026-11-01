import { useEffect, useState } from 'react'
import type { BanReason, BanSuggestion } from '../../../shared/dataTypes'
import { selectActiveProfile, useApp } from '../store/useApp'
import { pct, ROLE_SHORT } from '../lib/format'
import { ChampionIcon, useChampionName } from './Icons'

function ReasonText({ reason }: { reason: BanReason }) {
  const champ = useChampionName(reason.kind === 'counter' ? reason.championId : 0)
  if (reason.kind === 'counter') {
    return (
      <>
        Atrapalha {champ} de {reason.nickname}: vence {pct(reason.winrate)} do confronto ({reason.games} jogos)
      </>
    )
  }
  return (
    <>
      Forte no meta de {ROLE_SHORT[reason.role]}: tier {reason.tier}, {pct(reason.winrate)} de vitórias
    </>
  )
}

function Row({ s }: { s: BanSuggestion }) {
  const name = useChampionName(s.championId)
  return (
    <li className="flex items-start gap-3 py-2">
      <ChampionIcon id={s.championId} size={36} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-snow">{name}</div>
        <ul className="mt-0.5 space-y-0.5 text-xs text-mist">
          {s.reasons.map((r, i) => (
            <li key={i}>
              <ReasonText reason={r} />
            </li>
          ))}
        </ul>
      </div>
    </li>
  )
}

/** Quem banir: counters dos campeões de conforto alto de você e dos amigos, mais os fortes do meta. */
export function BanSuggestions() {
  const draft = useApp((s) => s.draft)
  const owner = useApp(selectActiveProfile)
  const [items, setItems] = useState<BanSuggestion[]>([])
  const [open, setOpen] = useState(true)

  const signature = draft
    ? [
        draft.phase,
        draft.bans.allies.join(','),
        draft.bans.enemies.join(','),
        draft.allies.map((p) => `${p.cellId}:${p.championId}:${p.status}:${p.role ?? ''}:${p.profileId ?? ''}`).join('|'),
        draft.enemies.map((p) => `${p.championId}:${p.status}`).join('|')
      ].join('#')
    : ''
  const profileId = owner?.id

  useEffect(() => {
    if (!signature) {
      setItems([])
      return
    }
    let cancelled = false
    window.api
      .getBanSuggestions({ profileId })
      .then((r) => !cancelled && setItems(r))
      .catch(() => !cancelled && setItems([]))
    return () => {
      cancelled = true
    }
  }, [signature, profileId])

  if (items.length === 0) return null

  return (
    <section aria-label="Sugestões de banimento" className="border border-line bg-panel/70 px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm text-snow"
      >
        <span>Sugestões de banimento</span>
        <span className="text-xs text-mist">{open ? 'Ocultar' : `Mostrar (${items.length})`}</span>
      </button>
      {open && (
        <ul className="mt-1 divide-y divide-line/60">
          {items.map((s) => (
            <Row key={s.championId} s={s} />
          ))}
        </ul>
      )}
    </section>
  )
}
