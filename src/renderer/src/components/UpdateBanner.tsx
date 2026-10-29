import { useState } from 'react'
import { useApp } from '../store/useApp'
import { btn, btnGold } from '../lib/ui'

/**
 * Aviso de versão nova. Nunca baixa nem reinicia sozinho: a pessoa decide.
 * Durante uma seleção de campeões o botão de reiniciar fica travado, para ninguém perder o draft.
 */
export function UpdateBanner() {
  const update = useApp((s) => s.update)
  const dismissed = useApp((s) => s.updateDismissed)
  const inDraft = useApp((s) => s.draft !== null)
  const download = useApp((s) => s.downloadUpdate)
  const install = useApp((s) => s.installUpdate)
  const dismiss = useApp((s) => s.dismissUpdate)
  const [showNotes, setShowNotes] = useState(false)

  if (!update) return null
  const { status, latest, notes, percent } = update
  if (status === 'available' && dismissed === latest) return null
  if (!['available', 'downloading', 'ready'].includes(status)) return null

  return (
    <div role="status" aria-label="Atualização do app" className="border-b border-ally/40 bg-ally/10 px-5 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="chamfer-sm num bg-ally px-2 py-0.5 text-xs font-semibold text-night">NOVO</span>

        {status === 'available' && (
          <>
            <span>
              A versão <strong className="font-semibold">{latest}</strong> do Pedro.gg está disponível (você usa a {update.current}).
            </span>
            {notes && (
              <button type="button" className="text-mist underline underline-offset-4 hover:text-snow" onClick={() => setShowNotes((v) => !v)}>
                {showNotes ? 'Ocultar novidades' : 'Ver novidades'}
              </button>
            )}
            <span className="ml-auto flex gap-2">
              <button type="button" className={btnGold} onClick={() => void download()}>
                Atualizar agora
              </button>
              <button type="button" className={btn} onClick={dismiss}>
                Depois
              </button>
            </span>
          </>
        )}

        {status === 'downloading' && (
          <>
            <span>Baixando a versão {latest}…</span>
            <span
              role="progressbar"
              aria-label="Progresso do download"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? 0}
              className="h-2 w-48 bg-line"
            >
              <span className="block h-full bg-ally transition-[width]" style={{ width: `${percent ?? 0}%` }} />
            </span>
            <span className="num text-mist">{percent ?? 0}%</span>
          </>
        )}

        {status === 'ready' && (
          <>
            <span>
              A versão <strong className="font-semibold">{latest}</strong> está pronta. O app fecha e abre de novo sozinho.
            </span>
            <span className="ml-auto flex items-center gap-3">
              {inDraft && <span className="text-mist">Termine a seleção de campeões antes de reiniciar.</span>}
              <button type="button" className={btnGold} disabled={inDraft} onClick={() => void install()}>
                Reiniciar e atualizar
              </button>
            </span>
          </>
        )}
      </div>
      {status === 'available' && showNotes && notes && (
        <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap border-l-2 border-ally/50 pl-3 font-sans text-xs text-mist">{notes}</pre>
      )}
    </div>
  )
}
