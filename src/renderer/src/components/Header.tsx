import { LogoMark } from './Logo'
import type { LcuStatus } from '../../../shared/types'
import { useEffect, useState } from 'react'
import { selectActiveProfile, useApp } from '../store/useApp'
import { btnGold } from '../lib/ui'

const STATUS: Record<LcuStatus, { label: string; dot: string; pulse: boolean }> = {
  searching: { label: 'Procurando o LoL', dot: 'bg-gold', pulse: true },
  connected: { label: 'Conectado ao cliente', dot: 'bg-good', pulse: false },
  disconnected: { label: 'Cliente fechado', dot: 'bg-enemy', pulse: false }
}

/** Foto de perfil do LoL (a do cliente); sem ela ou sem internet, a inicial do nome. */
export function Avatar({ name, iconId, version, size = 32 }: { name: string; iconId?: number; version?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [iconId, version])
  const src = iconId !== undefined && version ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${iconId}.png` : null
  return src && !failed ? (
    <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} draggable={false} className="shrink-0 rounded-full border border-gold/60 object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full border border-gold/30 bg-gold/15 font-display font-semibold text-gold" style={{ width: size, height: size, fontSize: Math.max(12, size * 0.4) }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase() || '?'}
    </span>
  )
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
      data-tour="autoaccept"
      title="Quando a partida for encontrada, o Pedro.gg clica em Aceitar por você (pelo cliente do LoL, sem usar o mouse)."
      className={`app-no-drag flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border py-1 pl-3 pr-1.5 text-sm transition-colors max-[1180px]:pl-1.5 ${
        flash ? 'border-good/60 bg-good/10 text-good' : on ? 'border-gold/50 bg-gold/10 text-gold' : 'border-line bg-panel/80 text-mist hover:border-mist/50 hover:text-snow'
      }`}
    >
      <span className="max-[1180px]:sr-only">{flash ? 'Partida aceita!' : on ? 'Aceite automático' : 'Aceite manual'}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on || flash ? 'bg-gold/70' : 'bg-line'}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-snow shadow transition-all ${on || flash ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

const NAV: { id: 'draft' | 'postgame' | 'meta' | 'pools' | 'coach'; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'meta', label: 'Meta' },
  { id: 'postgame', label: 'Pós-jogo' },
  { id: 'coach', label: 'Treino' },
  { id: 'pools', label: 'Pools' }
]

export function Header() {
  const status = useApp((s) => s.lcuStatus)
  const profiles = useApp((s) => s.profiles)
  const active = useApp(selectActiveProfile)
  const account = useApp((s) => s.identity?.account)
  const linked = useApp((s) => s.identity?.profileId ?? null)
  const version = useApp((s) => s.catalog?.version)
  const openPool = useApp((s) => s.openPool)
  const openSettings = useApp((s) => s.openSettings)
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const draft = useApp((s) => s.draft)
  const st = STATUS[status]
  const shownName = account ? account.gameName : (active?.nickname ?? 'Escolher perfil')

  return (
    <header
      className="app-drag relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-night pl-6"
      style={{ paddingRight: 'max(16px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 12px))' }}
    >
      {/* esquerda: marca */}
      <div className="flex shrink-0 items-center gap-2.5">
        <LogoMark size={32} small />
        <span className="truncate font-display text-lg font-bold tracking-wider max-[760px]:sr-only">PEDRO.GG</span>
        <span className="hidden whitespace-nowrap text-sm text-mist min-[1500px]:inline">Draft Companion</span>
      </div>

      {/* centro: telas */}
      <nav className="app-no-drag ml-4 flex shrink-0 items-stretch gap-1 self-stretch whitespace-nowrap" role="tablist" aria-label="Telas">
        {NAV.map((n) => (
          <button
            key={n.id}
            data-tour={`nav-${n.id}`}
            type="button"
            role="tab"
            aria-selected={view === n.id}
            onClick={() => setView(n.id)}
            className={`relative border-b-2 px-3.5 text-[15px] font-medium transition-colors max-[900px]:px-2.5 ${
              view === n.id ? 'border-gold text-snow' : 'border-transparent text-mist hover:text-snow'
            }`}
          >
            {n.label}
            {n.id === 'draft' && draft && view !== 'draft' && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-good" aria-label="seleção em andamento" />
            )}
          </button>
        ))}
      </nav>

      {/* direita: conta, estado, aceite e configurações (nunca encolhe nem se sobrepõe) */}
      <div className="min-w-0 flex-1" aria-hidden="true" />
      <div className="app-no-drag flex shrink-0 items-center justify-end gap-2.5">
        {profiles.length === 0 && !account ? (
          <button type="button" className={btnGold} onClick={openPool}>
            Criar o primeiro perfil
          </button>
        ) : (
          <button
            type="button"
            onClick={openPool}
            title={account ? (linked ? 'Conta detectada no cliente. Abrir perfis e Pools' : 'Conta detectada, mas sem perfil. Clique para vincular a um perfil') : 'Abrir seus perfis e Pools'}
            className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-panel/80 py-0.5 pl-0.5 pr-3 text-sm transition-colors hover:border-mist/50 max-[1180px]:pr-0.5"
          >
            <Avatar name={shownName} iconId={account?.profileIconId} version={version} />
            <span className="flex max-w-36 flex-col text-left leading-tight max-[1180px]:sr-only">
              <span className="truncate font-medium">{shownName}</span>
              {account && !linked && <span className="text-[11px] text-gold">sem perfil · vincular</span>}
            </span>
          </button>
        )}
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-mist" role="status" title={st.label}>
          <span className="relative flex h-2.5 w-2.5">
            {st.pulse && <span className={`radar absolute inline-flex h-full w-full rounded-full ${st.dot}`} />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${st.dot}`} />
          </span>
          <span className="max-[1700px]:sr-only">{st.label}</span>
        </div>
        <AutoAcceptToggle />
        <button
          type="button"
          onClick={openSettings}
          aria-label="Configurações"
          data-tour="settings"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-panel/80 text-mist transition-colors hover:border-mist/50 hover:text-snow"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
            <path d="M8.3 1.5h3.4l.5 2.2c.5.2 1 .5 1.4.8l2.1-.8 1.7 3-1.7 1.5c.1.5.1 1.1 0 1.6l1.7 1.5-1.7 3-2.1-.8c-.4.3-.9.6-1.4.8l-.5 2.2H8.3l-.5-2.2c-.5-.2-1-.5-1.4-.8l-2.1.8-1.7-3 1.7-1.5a5 5 0 0 1 0-1.6L2.6 6.7l1.7-3 2.1.8c.4-.3.9-.6 1.4-.8zM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
          </svg>
        </button>
      </div>
    </header>
  )
}
