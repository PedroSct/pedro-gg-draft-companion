import { useEffect, useState } from 'react'
import type { BanReason, BanSuggestion } from '../../../shared/dataTypes'
import { selectActiveProfile, useApp } from '../store/useApp'
import { pct, ROLE_SHORT } from '../lib/format'
import { ChampionIcon, useChampionName } from './Icons'
import { DraftActButton } from './DraftActButton'
import { useFocus } from '../lib/useFocus'

function ReasonText({ reason, short = false }: { reason: BanReason; short?: boolean }) {
  const champ = useChampionName(reason.kind === 'counter' ? reason.championId : 0)
  if (reason.kind === 'avoid') return <>Você marcou como difícil de enfrentar</>
  if (reason.kind === 'habit') return <>Você costuma banir este campeão</>
  if (reason.kind === 'counter' && reason.self) {
    return short ? (
      <>
        Atrapalha {champ}, o que você quer jogar ({pct(reason.winrate)})
      </>
    ) : (
      <>
        Atrapalha {champ}, o campeão que você quer jogar: vence {pct(reason.winrate)} do confronto ({reason.games} jogos)
      </>
    )
  }
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
function Row({ s, best }: { s: BanSuggestion; best: boolean }) {
  const name = useChampionName(s.championId)
  const [open, setOpen] = useState(false)
  const more = s.reasons.length > 1
  return (
    <li className={best ? '-mx-3 rounded-lg bg-panel px-3 py-3' : 'border-b border-line py-3'}>
      <div className="flex items-center gap-3.5">
        <ChampionIcon id={s.championId} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-snow">{name}</span>
            {best && <span className="shrink-0 rounded-full border border-gold/50 px-2 text-[11px] text-gold">Melhor ban</span>}
          </div>
          <div className="truncate text-[13px] text-mist">
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
        <ul className="mt-1 space-y-0.5 pl-[54px] text-xs text-mist">
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
  const focus = useFocus()
  const focusId = focus?.forLocal ? focus.championId : undefined
  const focusName = useChampionName(focusId ?? 0)
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
      ].join('#') + `#f${focusId ?? 0}`
    : ''
  const profileId = owner?.id

  useEffect(() => {
    if (!signature) {
      setItems([])
      return
    }
    let cancelled = false
    window.api
      .getBanSuggestions({ profileId, focusChampionId: focusId })
      .then((r) => !cancelled && setItems(r))
      .catch(() => !cancelled && setItems([]))
    return () => {
      cancelled = true
    }
  }, [signature, profileId, focusId])

  if (items.length === 0) return null

  const banning = draft?.turn?.type === 'ban'
  const shown = showAll ? items : items.slice(0, TOP)

  return (
    <section aria-label="Sugestões de banimento">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 text-left"
      >
        <span className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold text-snow">Bans recomendados</span>
          {focusId ? <span className="text-xs text-dim">pensando em {focusName}</span> : banning ? <span className="text-xs text-dim">sua vez</span> : null}
        </span>
        <span className="text-xs text-mist">{open ? 'Ocultar' : `Mostrar (${items.length})`}</span>
      </button>
      {open && (
        <>
          <ul className="mt-2">
            {shown.map((s, i) => (
              <Row key={s.championId} s={s} best={i === 0} />
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
