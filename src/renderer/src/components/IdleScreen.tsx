import { selectActiveProfile, useApp } from '../store/useApp'
import { btn } from '../lib/ui'
import { BanPrefs } from './BanPrefs'
import { LogoMark } from './Logo'

const COPY = {
  searching: {
    title: 'Procurando o League of Legends',
    body: 'Abra o cliente e entre na sua conta. O app conecta sozinho e mostra o draft assim que a seleção de campeões começar.'
  },
  connected: {
    title: 'Conectado. Entre em uma fila.',
    body: 'Quando a seleção de campeões começar, os times, os bans e a sugestão de pick aparecem aqui.'
  },
  disconnected: {
    title: 'O cliente foi fechado',
    body: 'Abra o League of Legends de novo. O app volta a conectar em alguns segundos.'
  }
} as const

function Hex({ color, searching }: { color: string; searching: boolean }) {
  return (
    <div className="relative grid h-24 w-24 place-items-center">
      {searching && <span className="radar absolute inset-0 border border-gold/50" style={{ clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)' }} />}
      <LogoMark size={88} color={color} />
    </div>
  )
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="grid grid-cols-[20px_1fr_auto] items-center gap-3 border-b border-line py-3 last:border-b-0">
      <span aria-hidden="true" className={`grid h-4 w-4 place-items-center rounded-full border text-[10px] ${ok ? 'border-good text-good' : 'border-dim text-dim'}`}>
        {ok ? '✓' : '•'}
      </span>
      <span className="text-sm">{label}</span>
      {detail && <span className="text-[13px] text-dim">{detail}</span>}
    </li>
  )
}

export function IdleScreen() {
  const status = useApp((s) => s.lcuStatus)
  const openSettings = useApp((s) => s.openSettings)
  const metaInfo = useApp((s) => s.metaInfo)
  const profile = useApp(selectActiveProfile)
  const autoAccept = useApp((s) => s.settings?.autoAccept ?? false)
  const overlayOn = useApp((s) => s.settings?.overlayEnabled ?? false)
  const c = COPY[status]
  const color = status === 'disconnected' ? 'var(--color-enemy)' : 'var(--color-gold)'

  return (
    <div className="h-full overflow-y-auto py-2">
      <div className={`mx-auto grid w-full max-w-[1200px] gap-16 pt-10 ${status === 'connected' ? 'grid-cols-[minmax(0,1fr)_minmax(0,420px)] max-[1000px]:grid-cols-1' : 'grid-cols-1 justify-items-center text-center'}`}>
        <div className={status === 'connected' ? '' : 'flex max-w-md flex-col items-center'}>
          <Hex color={color} searching={status === 'searching'} />
          <h1 className="mt-5 font-display text-[34px] font-semibold leading-tight">{c.title}</h1>
          <p className="mt-3 max-w-md text-mist">{c.body}</p>
          {status !== 'connected' && (
            <button type="button" className={`${btn} mt-5`} onClick={openSettings}>
              Escolher a pasta do LoL manualmente
            </button>
          )}
          {status === 'connected' && (
            <ul className="mt-8 max-w-[520px]" aria-label="Estado do app">
              <Check ok label="Cliente do jogo conectado" />
              <Check ok={!!metaInfo && !metaInfo.isSample} label="Dados do meta" detail={metaInfo ? (metaInfo.isSample ? 'amostra' : `patch ${metaInfo.patch}`) : undefined} />
              <Check ok={!!profile} label="Perfil ativo" detail={profile?.nickname} />
              <Check ok={autoAccept} label="Aceite automático" detail={autoAccept ? 'ligado' : 'desligado'} />
              <Check ok={overlayOn} label="Overlay no jogo" detail={overlayOn ? 'ligado' : 'desligado'} />
            </ul>
          )}
        </div>
        {status === 'connected' && <BanPrefs />}
      </div>
    </div>
  )
}
