import { useEffect, useState } from 'react'
import type { Catalog } from '../../../shared/dataTypes'
import type { OverlayState } from '../../../shared/overlay'
import { ROLE_SHORT } from '../lib/format'

const KEYS = ['Q', 'W', 'E', 'R'] as const
const MAX: Record<(typeof KEYS)[number], number> = { Q: 5, W: 5, E: 5, R: 3 }

const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function Pips({ value, max }: { value: number; max: number }) {
  return (
    <span className="mt-1 flex justify-center gap-0.5" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < value ? 'bg-gold' : 'bg-white/20'}`} />
      ))}
    </span>
  )
}

/** Painel pequeno e discreto que fica sobre o jogo: não recebe cliques (o mouse atravessa para o jogo). */
export default function Overlay() {
  const [state, setState] = useState<OverlayState | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('overlay-mode')
    let off: (() => void) | undefined
    void window.api.getOverlayState().then(setState).catch(() => undefined)
    void window.api.getCatalog().then(setCatalog).catch(() => undefined)
    off = window.api.onOverlayState(setState)
    return () => off?.()
  }, [])

  if (!state) return null
  const champ = catalog?.champions.find((c) => c.id === state.championId)
  const nextItem = state.items.find((i) => i.itemId === state.nextItemId)
  const nextItemName = nextItem ? catalog?.items[String(nextItem.itemId)]?.name : undefined
  const sk = state.skill

  return (
    <div role="region" aria-label="Pedro.gg no jogo" className="m-1 flex w-[292px] flex-col gap-2 rounded-2xl border border-white/10 bg-[#0b0e17]/90 p-3 text-snow shadow-2xl">
      <div className="flex items-center gap-2">
        {champ && <img src={champ.iconUrl} alt="" className="h-8 w-8 rounded-lg object-cover" draggable={false} />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-semibold leading-tight">{state.championName}</div>
          <div className="text-[11px] text-mist">
            {ROLE_SHORT[state.role]} · nível {state.level} · {fmtTime(state.gameTime)}
            {state.demo && <span className="ml-1 text-gold">· demonstração</span>}
          </div>
        </div>
      </div>

      {sk.next || sk.priority.length > 0 ? (
        <section aria-label="Habilidades">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-wide text-mist">Habilidades</span>
            {sk.next && (
              <span className={`text-sm font-semibold ${sk.ready ? 'text-gold' : 'text-mist'}`}>
                {sk.ready ? `Suba agora: ${sk.next}` : `Próxima: ${sk.next}`}
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {KEYS.map((k) => {
              const next = sk.next === k
              return (
                <div
                  key={k}
                  className={`rounded-lg border px-1 py-1.5 text-center ${next ? (sk.ready ? 'border-gold bg-gold/15' : 'border-gold/50 bg-gold/5') : 'border-white/10 bg-white/5'}`}
                >
                  <div className={`font-display text-lg font-bold leading-none ${next ? 'text-gold' : 'text-snow'}`}>{k}</div>
                  <Pips value={sk.levels[k]} max={MAX[k]} />
                </div>
              )
            })}
          </div>
          {sk.upcoming.length > 0 && <div className="mt-1 text-[11px] text-mist">Depois: {sk.upcoming.join(' → ')}</div>}
        </section>
      ) : null}

      {state.items.length > 0 && (
        <section aria-label="Itens">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-mist">Itens</span>
            {nextItemName && <span className="truncate text-xs text-gold">Comprar: {nextItemName}</span>}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {state.items.map((it, i) => {
              const info = catalog?.items[String(it.itemId)]
              const next = it.itemId === state.nextItemId
              return (
                <li key={`${it.itemId}-${i}`} className={`relative h-10 w-10 overflow-hidden rounded-lg border ${next ? 'border-gold shadow-[0_0_8px_rgba(220,184,112,0.6)]' : 'border-white/10'}`} title={info?.name}>
                  {info ? (
                    <img src={info.iconUrl} alt={info.name} className={`h-full w-full object-cover ${it.owned ? 'opacity-40 grayscale' : ''}`} draggable={false} />
                  ) : (
                    <span className="grid h-full w-full place-items-center bg-white/5 text-[10px] text-mist">{it.itemId}</span>
                  )}
                  {it.owned && <span className="absolute inset-0 grid place-items-center text-lg font-bold text-ally">✓</span>}
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[8px] leading-3 text-mist">{it.label === 'Situacional' ? 'Situ.' : it.label}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {state.lowData && <p className="text-[10px] text-gold/80">Poucos dados para esta build: use como guia.</p>}
    </div>
  )
}
