import appIcon from '../assets/icon.png'
import type { LcuStatus } from '../../../shared/types'
import { useEffect, useState } from 'react'
import { selectActiveProfile, useApp } from '../store/useApp'
import { btn, btnGold } from '../lib/ui'

const STATUS: Record<LcuStatus, { label: string; dot: string; pulse: boolean }> = {
  searching: { label: 'Procurando o LoL', dot: 'bg-gold', pulse: true },
  connected: { label: 'Conectado ao cliente', dot: 'bg-ally', pulse: false },
  disconnected: { label: 'Cliente fechado', dot: 'bg-enemy', pulse: false }
}

/** Liga/desliga o "aceitar partida automaticamente" e avisa quando aceitou uma. */
function AutoAcceptToggle() {
  const on = useApp((s) => s.settings?.autoAccept ?? false)
  const saveSettings = useApp((s) => s.saveSettings)
  const at = useApp((s) => s.autoAcceptedAt)
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!at) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 4000)
    return () => clearTimeout(t)
  }, [at])

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => void saveSettings({ autoAccept: !on })}
      title="Quando a partida for encontrada, o Pedro.gg clica em Aceitar por você (pelo cliente do LoL, sem usar o mouse)."
      className={`flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-sm transition-colors ${
        on ? 'border-gold/60 bg-gold/10 text-gold' : 'border-line bg-panel text-mist hover:border-mist/50'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${on ? 'bg-gold' : 'bg-mist/40'}`} />
      {flash ? 'Partida aceita!' : on ? 'Aceitar: automático' : 'Aceitar: manual'}
    </button>
  )
}

export function Header() {
  const status = useApp((s) => s.lcuStatus)
  const profiles = useApp((s) => s.profiles)
  const active = useApp(selectActiveProfile)
  const setActive = useApp((s) => s.setActiveProfile)
  const openPool = useApp((s) => s.openPool)
  const openSettings = useApp((s) => s.openSettings)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const draft = useApp((s) => s.draft)
  const st = STATUS[status]

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-deck/80 px-5 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <img src={appIcon} alt="" width={32} height={32} className="h-8 w-8" draggable={false} />
        <span className="font-display text-xl font-semibold tracking-wide">Pedro.gg</span>
        <span className="text-sm text-mist">Draft Companion</span>
      </div>

      <nav className="flex items-center gap-5 pl-2" role="tablist" aria-label="Telas">
        <button type="button" role="tab" className="tab" aria-selected={view === 'draft'} onClick={() => setView('draft')}>
          Draft
          {draft && view !== 'draft' && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ally align-middle" aria-label="seleção em andamento" />}
        </button>
        <button type="button" role="tab" className="tab" aria-selected={view === 'postgame'} onClick={() => setView('postgame')}>
          Pós-jogo
        </button>
      </nav>

      <div className="mx-auto flex items-center gap-2.5">
        {profiles.length > 0 ? (
          <>
            <label htmlFor="friend" className="text-sm text-mist">
              Quem está jogando
            </label>
            <select
              id="friend"
              value={active?.id ?? ''}
              onChange={(e) => void setActive(e.target.value)}
              className="min-w-44 rounded-sm border border-line bg-panel px-2.5 py-1.5 font-display text-lg font-semibold hover:border-mist/50"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname}
                </option>
              ))}
            </select>
          </>
        ) : (
          <button type="button" className={btnGold} onClick={openPool}>
            Criar o primeiro perfil
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-mist" role="status">
          <span className="relative flex h-2.5 w-2.5">
            {st.pulse && <span className={`radar absolute inline-flex h-full w-full rounded-full ${st.dot}`} />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${st.dot}`} />
          </span>
          {st.label}
        </div>
        <AutoAcceptToggle />
        <button type="button" className={btn} onClick={openPool}>
          Pools
        </button>
        <button type="button" className={btn} onClick={openSettings} aria-label="Configurações">
          <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
            <path d="M8.3 1.5h3.4l.5 2.2c.5.2 1 .5 1.4.8l2.1-.8 1.7 3-1.7 1.5c.1.5.1 1.1 0 1.6l1.7 1.5-1.7 3-2.1-.8c-.4.3-.9.6-1.4.8l-.5 2.2H8.3l-.5-2.2c-.5-.2-1-.5-1.4-.8l-2.1.8-1.7-3 1.7-1.5a5 5 0 0 1 0-1.6L2.6 6.7l1.7-3 2.1.8c.4-.3.9-.6 1.4-.8zM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
