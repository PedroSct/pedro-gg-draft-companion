import { useEffect, useState } from 'react'
import { LogoMark } from './Logo'

/** Tempo mínimo na tela: dá para ver o hexágono se desenhar, o nome entrar e a barra encher. */
const MIN_MS = 1900

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
    const t = setTimeout(() => setGone(true), 460)
    return () => clearTimeout(t)
  }, [leaving])

  if (gone) return null
  return (
    <div
      aria-hidden="true"
      className={`splash pointer-events-none fixed inset-0 z-[60] flex flex-col items-center justify-center bg-night ${leaving ? 'splash-leaving' : ''}`}
    >
      <LogoMark size={148} animated />
      <div className="splash-word mt-7 font-display text-[34px] font-bold text-snow">PEDRO.GG</div>
      <div className="splash-tag mt-3 text-sm text-mist">Draft Companion</div>
      <div className="splash-bar absolute bottom-[72px] h-[2px] w-[180px] overflow-hidden bg-line">
        <i className="splash-fill block h-full w-full bg-gold" />
      </div>
    </div>
  )
}
