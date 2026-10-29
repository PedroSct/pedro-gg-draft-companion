import { useApp } from '../store/useApp'
import { btn } from '../lib/ui'

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

export function IdleScreen() {
  const status = useApp((s) => s.lcuStatus)
  const openSettings = useApp((s) => s.openSettings)
  const c = COPY[status]

  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="relative mb-8 grid h-28 w-28 place-items-center">
          {status === 'searching' && (
            <span className="radar absolute inset-0 border border-gold/60" style={{ clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)' }} />
          )}
          <svg viewBox="0 0 32 32" className="relative h-20 w-20" aria-hidden="true">
            <polygon
              points="16,2 28,9 28,23 16,30 4,23 4,9"
              fill="none"
              stroke={status === 'connected' ? 'var(--color-ally)' : status === 'disconnected' ? 'var(--color-enemy)' : 'var(--color-gold)'}
              strokeWidth="1.2"
            />
            <polygon points="16,9 22,12.5 22,19.5 16,23 10,19.5 10,12.5" fill="var(--color-line)" />
          </svg>
        </div>
        <h1 className="font-display text-3xl font-semibold">{c.title}</h1>
        <p className="mt-2 text-mist">{c.body}</p>
        {status !== 'connected' && (
          <button type="button" className={`${btn} mt-5`} onClick={openSettings}>
            Escolher a pasta do LoL manualmente
          </button>
        )}
      </div>
    </div>
  )
}
