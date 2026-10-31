import { useEffect, useState } from 'react'
import appIcon from '../assets/icon.png'

const MIN_MS = 1500

/** Abertura animada. Some quando o app termina de carregar (e depois de um tempo mínimo para dar para ver). */
export function Splash({ ready }: { ready: boolean }) {
  const [minDone, setMinDone] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMinDone(true), MIN_MS)
    return () => clearTimeout(t)
  }, [])

  const leaving = ready && minDone
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => setGone(true), 560)
    return () => clearTimeout(t)
  }, [leaving])

  if (gone) return null
  return (
    <div
      aria-hidden="true"
      className={`splash pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-night ${leaving ? 'splash-leaving' : ''}`}
      style={{ backgroundImage: 'radial-gradient(700px 360px at 50% 42%, rgb(60 201 220 / 0.14), transparent 70%)' }}
    >
      <div className="flex flex-col items-center">
        <div className="relative grid h-40 w-40 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
            <polygon className="splash-ring" pathLength={1} points="50,4 90,27 90,73 50,96 10,73 10,27" fill="none" stroke="var(--color-gold)" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <img src={appIcon} alt="" width={84} height={84} className="splash-logo h-[84px] w-[84px]" draggable={false} />
        </div>
        <div className="splash-logo mt-6 font-display text-4xl font-semibold tracking-[0.3em] text-snow" style={{ animationDelay: '250ms' }}>
          PEDRO.GG
        </div>
        <div className="splash-logo mt-1 text-sm tracking-widest text-mist" style={{ animationDelay: '450ms' }}>
          DRAFT COMPANION
        </div>
      </div>
    </div>
  )
}
