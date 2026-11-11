import { useEffect, useState } from 'react'
import type { BanReason, BanSuggestion } from '../../../shared/dataTypes'
import { selectActiveProfile, useApp } from '../store/useApp'
import { pct, ROLE_SHORT } from '../lib/format'
import { ChampionIcon, useChampionName } from './Icons'
import { DraftActButton } from './DraftActButton'

function ReasonText({ reason, short = false }: { reason: BanReason; short?: boolean }) {
  const champ = useChampionName(reason.kind === 'counter' ? reason.championId : 0)
  if (reason.kind === 'counter') {
    return short ? (
      <>
        Atrapalha {champ} de {reason.nickname} ({pct(reason.winrate)})
      </>
    ) : (
      <>
        Atrapalha {champ} de {reason.nickname}: vence {pct(reason.winrate)} do confronto ({reason.games} jogos)
      </>
    )
  }
  return short ? (
    <>
      Meta de {ROLE_SHORT[reason.role]}: tier {reason.tier}
    </>
  ) : (
    <>
      Forte no meta de {ROLE_SHORT[reason.role]}: tier {reason.tier}, {pct(reason.winrate)} de vitórias
    </>
  )
}

/** Uma linha por sugestão: ícone, nome e o motivo principal. Os outros motivos abrem sob demanda. */
function Row({ s }: { s: BanSuggestion }) {
  const name = useChampionName(s.championId)
  const [open, setOpen] = useState(false)
  const more = s.reasons.length > 1
  return (
    <li className="py-1.5">
      <div className="flex items-center gap-3">
        <ChampionIcon id={s.championId} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-snow">{name}</div>
          <div className="truncate text-xs text-mist">
            <ReasonText reason={s.reasons[0]} short />
          </div>
        </div>
        {more && (
          <button type="button" aria-expanded={open} aria-label={`Detalhes de ${name}`} onClick={() => setOpen((v) => !v)} className="shrink-0 text-xs text-mist underline-offset-4 hover:text-snow hover:underline">
            {open ? 'Menos' : `+${s.reasons.length - 1}`}
          </button>
        )}
        <DraftActButton championId={s.championId} type="ban" compact />
      </div>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-11 text-xs text-mist">
          {s.reasons.map((r, i) => (
            <li key={i}>
              <ReasonText reason={r} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

const TOP = 3

/** Quem banir: counters dos campeões de conforto alto de você e dos amigos, mais os fortes do meta. */
export function BanSuggestions() {
  const draft = useApp((s) => s.draft)
  const owner = useApp(selectActiveProfile)
  const [items, setItems] = useState<BanSuggestion[]>([])
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)

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

  const banning = draft?.turn?.type === 'ban'
  const shown = showAll ? items : items.slice(0, TOP)

  return (
    <section aria-label="Sugestões de banimento" className="border border-line bg-panel/70 px-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm text-snow"
      >
        <span>{banning ? 'É a sua vez de banir' : 'Sugestões de banimento'}</span>
        <span className="text-xs text-mist">{open ? 'Ocultar' : `Mostrar (${items.length})`}</span>
      </button>
      {open && (
        <>
          <ul className="mt-1 divide-y divide-line/60">
            {shown.map((s) => (
              <Row key={s.championId} s={s} />
            ))}
          </ul>
          {items.length > TOP && (
            <button type="button" className="mt-1 text-xs text-mist underline-offset-4 hover:text-snow hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Mostrar menos' : `Ver mais ${items.length - TOP}`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
