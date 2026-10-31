import appIcon from '../assets/icon.png'
import type { LcuStatus } from '../../../shared/types'
import { useEffect, useState } from 'react'
import { selectActiveProfile, useApp } from '../store/useApp'
import { btnGold } from '../lib/ui'

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
      className={`app-no-drag flex items-center gap-2.5 rounded-full border py-1 pl-3 pr-1.5 text-sm transition-colors ${
        flash ? 'border-ally/60 bg-ally/10 text-ally' : on ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-panel/80 text-mist hover:border-mist/50 hover:text-snow'
      }`}
    >
      {flash ? 'Partida aceita!' : on ? 'Aceitar: automático' : 'Aceitar: manual'}
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on || flash ? 'bg-gold/70' : 'bg-line'}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-snow shadow transition-all ${on || flash ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

const NAV: { id: 'draft' | 'postgame'; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'postgame', label: 'Pós-jogo' }
]

export function Header() {
  const status = useApp((s) => s.lcuStatus)
  const profiles = useApp((s) => s.profiles)
  const active = useApp(selectActiveProfile)
  const account = useApp((s) => s.identity?.account)
  const linked = useApp((s) => s.identity?.profileId ?? null)
  const openPool = useApp((s) => s.openPool)
  const openSettings = useApp((s) => s.openSettings)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const draft = useApp((s) => s.draft)
  const st = STATUS[status]

  return (
    <header
      className="app-drag relative z-20 flex h-[52px] shrink-0 items-center gap-4 border-b border-line/70 bg-deck/95 pl-4"
      style={{ paddingRight: 'max(16px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 12px))' }}
    >
      <div className="flex items-center gap-2.5">
        <img src={appIcon} alt="" width={30} height={30} className="h-[30px] w-[30px]" draggable={false} />
        <span className="font-display text-xl font-semibold tracking-wide">Pedro.gg</span>
        <span className="hidden text-sm text-mist xl:inline">Draft Companion</span>
      </div>

      <nav className="app-no-drag flex items-center gap-1 rounded-xl border border-line/70 bg-panel/70 p-1" role="tablist" aria-label="Telas">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            role="tab"
            aria-selected={view === n.id}
            onClick={() => setView(n.id)}
            className={`relative rounded-lg px-3.5 py-1 font-display text-base font-semibold tracking-wide transition-colors ${
              view === n.id ? 'bg-raised text-snow shadow-[0_0_0_1px_rgb(220_184_112/0.35)]' : 'text-mist hover:text-snow'
            }`}
          >
            {n.label}
            {n.id === 'draft' && draft && view !== 'draft' && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-ally" aria-label="seleção em andamento" />
            )}
          </button>
        ))}
        <button type="button" onClick={openPool} className="rounded-lg px-3.5 py-1 font-display text-base font-semibold tracking-wide text-mist transition-colors hover:text-snow">
          Pools
        </button>
      </nav>

      <div className="flex-1" />

      <div className="app-no-drag flex items-center gap-3">
        {profiles.length === 0 && !account ? (
          <button type="button" className={btnGold} onClick={openPool}>
            Criar o primeiro perfil
          </button>
        ) : (
          <button
            type="button"
            onClick={openPool}
            title={account ? (linked ? 'Conta detectada no cliente. Abrir perfis e Pools' : 'Conta detectada, mas sem perfil. Clique para vincular a um perfil') : 'Abrir seus perfis e Pools'}
            className="flex items-center gap-2 rounded-full border border-line bg-panel/80 py-1 pl-1 pr-3 text-sm transition-colors hover:border-mist/50"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-gold/15 font-display text-sm font-semibold text-gold" aria-hidden="true">
              {(account?.gameName ?? active?.nickname ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="flex max-w-48 flex-col text-left leading-tight">
              <span className="truncate font-medium">{account ? account.gameName : (active?.nickname ?? 'Escolher perfil')}</span>
              {account && !linked && <span className="text-[11px] text-gold">sem perfil · vincular</span>}
            </span>
          </button>
        )}
        <div className="flex items-center gap-2 text-sm text-mist" role="status">
          <span className="relative flex h-2.5 w-2.5">
            {st.pulse && <span className={`radar absolute inline-flex h-full w-full rounded-full ${st.dot}`} />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${st.dot}`} />
          </span>
          {st.label}
        </div>
        <AutoAcceptToggle />
        <button
          type="button"
          onClick={openSettings}
          aria-label="Configurações"
          className="grid h-8 w-8 place-items-center rounded-full border border-line bg-panel/80 text-mist transition-colors hover:border-mist/50 hover:text-snow"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
            <path d="M8.3 1.5h3.4l.5 2.2c.5.2 1 .5 1.4.8l2.1-.8 1.7 3-1.7 1.5c.1.5.1 1.1 0 1.6l1.7 1.5-1.7 3-2.1-.8c-.4.3-.9.6-1.4.8l-.5 2.2H8.3l-.5-2.2c-.5-.2-1-.5-1.4-.8l-2.1.8-1.7-3 1.7-1.5a5 5 0 0 1 0-1.6L2.6 6.7l1.7-3 2.1.8c.4-.3.9-.6 1.4-.8zM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
