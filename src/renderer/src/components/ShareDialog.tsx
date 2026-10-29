import { useEffect, useState } from 'react'
import type { ProfileInput } from '../../../shared/api'
import { btn, btnGold } from '../lib/ui'

/** Gera o código (e o arquivo) para mandar a Pool de um perfil a um amigo. */
export function ShareDialog({ profile, onClose }: { profile: ProfileInput; onClose: () => void }) {
  const [includeNotes, setIncludeNotes] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    window.api
      .encodeShare(profile, { includeNotes })
      .then((c) => !cancelled && setCode(c))
      .catch(() => !cancelled && setError('Não foi possível gerar o código. Confira se o perfil tem apelido.'))
    return () => {
      cancelled = true
    }
    // O perfil só muda se o diálogo fechar: ele é uma foto do formulário no momento do clique.
  }, [profile, includeNotes])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function copy(): Promise<void> {
    await window.api.copyText(code)
    setMessage('Código copiado. Cole na conversa com seu amigo.')
  }

  async function saveFile(): Promise<void> {
    const r = await window.api.exportShareFile(profile, { includeNotes })
    if (r.ok) setMessage('Arquivo salvo. Mande-o para seu amigo.')
    else if (r.reason === 'error') setError('Não foi possível salvar o arquivo.')
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-night/80 p-6">
      <div role="dialog" aria-modal="true" aria-label="Compartilhar Pool" className="w-full max-w-lg border border-line bg-deck">
        <div className="flex items-center border-b border-line px-5 py-3">
          <h2 className="font-display text-xl font-semibold">Compartilhar a Pool de {profile.nickname || 'este perfil'}</h2>
          <button type="button" className={`${btn} ml-auto`} onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <p className="text-sm text-mist">
            Mande este código para um amigo. No app dele: <strong className="text-snow">Pools → Importar</strong> e colar. Ele escolhe se cria um
            perfil novo ou junta com um que já tem.
          </p>
          <label htmlFor="share-code" className="sr-only">
            Código da Pool
          </label>
          <textarea
            id="share-code"
            readOnly
            value={code}
            rows={5}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full resize-none break-all rounded-sm border border-line bg-night p-2.5 font-mono text-xs text-snow"
          />
          <label className="flex items-center gap-2 text-sm text-mist">
            <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
            Incluir minhas anotações (dos campeões e do perfil)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnGold} disabled={!code} onClick={() => void copy()}>
              Copiar código
            </button>
            <button type="button" className={btn} disabled={!code} onClick={() => void saveFile()}>
              Salvar como arquivo
            </button>
          </div>
          {message && (
            <p role="status" className="text-sm text-ally">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-enemy">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
