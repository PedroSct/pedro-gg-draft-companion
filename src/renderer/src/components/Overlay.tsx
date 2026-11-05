import { useEffect, useState, type CSSProperties } from 'react'
import type { Catalog } from '../../../shared/dataTypes'
import type { OverlayItemStep, OverlayState } from '../../../shared/overlay'
import { ROLE_SHORT } from '../lib/format'

const KEYS = ['Q', 'W', 'E', 'R'] as const
const MAX: Record<(typeof KEYS)[number], number> = { Q: 5, W: 5, E: 5, R: 3 }
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties
const DRAG = { WebkitAppRegion: 'drag' } as CSSProperties

const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const fmtGold = (n: number): string => n.toLocaleString('pt-BR')
/** a ultimate ganha outra cor para não se confundir com as demais */
const keyColor = (k: string): string => (k === 'R' ? 'text-[#c4a8ff]' : 'text-snow')

function Pips({ value, max, ult }: { value: number; max: number; ult: boolean }) {
  return (
    <span className="mt-1 flex justify-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < value ? (ult ? 'bg-[#c4a8ff]' : 'bg-gold') : 'bg-white/15'}`} />
      ))}
    </span>
  )
}

function Tile({ step, catalog, next, size }: { step: OverlayItemStep; catalog: Catalog | null; next: boolean; size: 'lg' | 'sm' }) {
  const info = catalog?.items[String(step.itemId)]
  const dim = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  return (
    <li className="flex w-12 flex-col items-center gap-0.5">
      <span
        className={`relative block overflow-hidden rounded-lg border ${dim} ${next ? 'border-gold shadow-[0_0_12px_rgba(220,184,112,0.55)]' : 'border-white/10'}`}
      >
        {info ? (
          <img src={info.iconUrl} alt={info.name} className={`h-full w-full object-cover ${step.owned ? 'opacity-35 grayscale' : ''}`} draggable={false} />
        ) : (
          <span className="grid h-full w-full place-items-center bg-white/5 text-[10px] text-mist">{step.itemId}</span>
        )}
        {step.owned && <span className="absolute inset-0 grid place-items-center text-base font-bold text-ally">✓</span>}
      </span>
      <span className={`text-[9px] leading-none ${next ? 'font-semibold text-gold' : 'text-dim'}`}>{step.label === 'Situacional' ? 'Situ.' : step.label}</span>
    </li>
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
  const nextStep = state.items.find((i) => i.itemId === state.nextItemId)
  const nextInfo = nextStep ? catalog?.items[String(nextStep.itemId)] : undefined
  const sk = state.skill
  const spent = KEYS.reduce((n, k) => n + sk.levels[k], 0)
  const starting = state.items.filter((i) => i.label === 'Inicial')
  const path = state.items.filter((i) => i.label !== 'Inicial' && i.label !== 'Situacional')
  const situ = state.items.filter((i) => i.label === 'Situacional')

  return (
    <div
      role="region"
      aria-label="Pedro.gg no jogo"
      style={{ ...(state.editing ? DRAG : {}), background: 'linear-gradient(165deg, rgba(22,28,44,0.95) 0%, rgba(9,11,18,0.95) 70%)' }}
      className={`m-1 flex w-[312px] flex-col gap-2.5 rounded-2xl border p-3 text-snow shadow-2xl ${state.editing ? 'cursor-move border-gold' : 'border-white/10'}`}
    >
      {state.editing && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-gold/15 px-2 py-1.5 text-xs text-gold">
          <span>Arraste o painel para onde quiser</span>
          <button type="button" style={NO_DRAG} className="cursor-pointer rounded-md bg-gold px-2 py-1 font-semibold text-[#0b0e17]" onClick={() => void window.api.finishOverlayMove()}>
            Salvar posição
          </button>
        </div>
      )}

      <header className="flex items-center gap-2.5">
        {champ && <img src={champ.iconUrl} alt="" className="h-10 w-10 rounded-xl border border-gold/50 object-cover" draggable={false} />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-semibold leading-tight">{state.championName}</div>
          <div className="text-[11px] text-mist">
            {ROLE_SHORT[state.role]} · nível {state.level} · {fmtTime(state.gameTime)}
            {state.demo && <span className="ml-1 text-gold">· demonstração</span>}
          </div>
        </div>
        {state.gold !== undefined && (
          <div className="text-right" aria-label="Ouro">
            <div className="font-display text-base font-semibold leading-none text-gold">{fmtGold(state.gold)}</div>
            <div className="mt-0.5 text-[9px] uppercase tracking-wide text-dim">ouro</div>
          </div>
        )}
      </header>

      {sk.next || sk.priority.length > 0 ? (
        <section aria-label="Habilidades" className="rounded-xl border border-white/8 bg-white/[0.04] p-2.5">
          <div className="flex items-center gap-3">
            {sk.next ? (
              <div
                aria-label={sk.ready ? `Suba agora: ${sk.next}` : `Próxima: ${sk.next}`}
                role="img"
                className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl border-2 font-display text-3xl font-bold ${
                  sk.ready ? 'overlay-pulse border-gold bg-gold/20 text-gold' : 'border-white/15 bg-white/5 text-mist'
                }`}
              >
                {sk.next}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className={`font-display text-base font-semibold leading-tight ${sk.ready ? 'text-gold' : 'text-mist'}`}>{sk.ready ? 'Suba agora' : sk.next ? 'Próxima habilidade' : 'Habilidades'}</div>
              <div className="text-[11px] text-mist">{sk.next ? (sk.ready ? 'Há ponto de habilidade para gastar' : `Ponto no nível ${spent + 1}`) : 'Sem ordem de habilidades nos dados'}</div>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-4 gap-1.5">
            {KEYS.map((k) => {
              const isNext = sk.next === k
              return (
                <div key={k} className={`rounded-lg border px-1 py-1.5 text-center ${isNext ? 'border-gold/70 bg-gold/10' : 'border-white/10 bg-black/20'}`}>
                  <div className={`font-display text-base font-bold leading-none ${isNext ? 'text-gold' : keyColor(k)}`}>{k}</div>
                  <Pips value={sk.levels[k]} max={MAX[k]} ult={k === 'R'} />
                </div>
              )
            })}
          </div>

          {sk.upcoming.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-dim">Depois</span>
              <ol className="flex flex-1 gap-1" aria-label="Próximos pontos">
                {sk.upcoming.map((k, i) => (
                  <li key={i} className="flex flex-1 flex-col items-center rounded-md bg-black/25 py-0.5">
                    <span className="text-[8px] leading-none text-dim">nv {spent + 2 + i}</span>
                    <span className={`font-display text-sm font-bold leading-tight ${keyColor(k)}`}>{k}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      ) : null}

      {state.items.length > 0 && (
        <section aria-label="Itens" className="rounded-xl border border-white/8 bg-white/[0.04] p-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="font-display text-sm font-semibold">Build</span>
            {nextStep && nextInfo ? (
              <span className="truncate text-[11px] text-gold">
                Comprar: {nextInfo.name}
                {nextInfo.goldTotal > 0 && <span className="text-mist"> · {fmtGold(nextInfo.goldTotal)} g</span>}
              </span>
            ) : (
              path.length > 0 && path.every((i) => i.owned) && <span className="text-[11px] text-ally">Build completa</span>
            )}
          </div>
          {starting.length > 0 && (
            <ul className="mb-1.5 flex gap-1" aria-label="Itens iniciais">
              {starting.map((it, i) => (
                <Tile key={`s${it.itemId}-${i}`} step={it} catalog={catalog} next={false} size="sm" />
              ))}
            </ul>
          )}
          <ul className="flex items-start gap-0.5" aria-label="Ordem de compra">
            {path.map((it, i) => (
              <Tile key={`${it.itemId}-${i}`} step={it} catalog={catalog} next={it.itemId === state.nextItemId} size="lg" />
            ))}
          </ul>
          {situ.length > 0 && (
            <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
              <span className="text-[10px] uppercase tracking-wide text-dim">Se precisar</span>
              <ul className="flex gap-1" aria-label="Itens situacionais">
                {situ.map((it, i) => (
                  <Tile key={`${it.itemId}-${i}`} step={it} catalog={catalog} next={false} size="sm" />
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {state.lowData && <p className="text-[10px] text-gold/80">Poucos dados para esta build: use como guia.</p>}
    </div>
  )
}
