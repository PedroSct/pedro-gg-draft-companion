import { useEffect, useMemo, useState } from 'react'
import { ROLES, type Pool } from '../../../shared/dataTypes'
import { countNew, poolSize, type ImportMode, type SharedProfile } from '../../../shared/poolShare'
import { ROLE_LABEL } from '../lib/format'
import { btn, btnGold } from '../lib/ui'
import { ChampionIcon } from './Icons'

interface Props {
  /** Perfil aberto no editor (só ele pode receber "juntar" ou "substituir"); null = nenhum salvo */
  target: { nickname: string; pool: Pool } | null
  onApply: (mode: ImportMode, shared: SharedProfile) => void
  onClose: () => void
}

/** Recebe a Pool de um amigo (código colado ou arquivo), mostra o que veio e deixa escolher como aplicar. */
export function ImportDialog({ target, onApply, onClose }: Props) {
  const [text, setText] = useState('')
  const [shared, setShared] = useState<SharedProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<ImportMode>('new')

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

  // Lê o texto sempre que muda (o main valida tudo; aqui só mostramos o resultado).
  useEffect(() => {
    if (!text.trim()) {
      setShared(null)
      setError(null)
      return
    }
    let cancelled = false
    void window.api.decodeShare(text).then((r) => {
      if (cancelled) return
      if (r.ok) {
        setShared(r.shared)
        setError(null)
      } else {
        setShared(null)
        setError(r.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [text])

  async function paste(): Promise<void> {
    setText(await window.api.readClipboardText())
  }

  async function openFile(): Promise<void> {
    const r = await window.api.importShareFile()
    if (r.ok) {
      setText('')
      setShared(r.shared)
      setError(null)
    } else if (r.reason === 'invalid') {
      setShared(null)
      setError(r.message ?? 'Arquivo inválido.')
    }
  }

  const added = useMemo(() => (shared && target ? countNew(target.pool, shared.pool) : 0), [shared, target])
  const total = shared ? poolSize(shared.pool) : 0

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-night/80 p-6">
      <div role="dialog" aria-modal="true" aria-label="Importar Pool" className="w-full max-w-2xl border border-line bg-deck">
        <div className="flex items-center border-b border-line px-5 py-3">
          <h2 className="font-display text-xl font-semibold">Importar a Pool de um amigo</h2>
          <button type="button" className={`${btn} ml-auto`} onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          <label htmlFor="import-code" className="text-sm text-mist">
            Cole o código que seu amigo mandou (começa com PGG1:) ou abra o arquivo.
          </label>
          <textarea
            id="import-code"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="PGG1:…"
            className="w-full resize-none break-all rounded-sm border border-line bg-night p-2.5 font-mono text-xs text-snow placeholder:text-dim"
          />
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => void paste()}>
              Colar da área de transferência
            </button>
            <button type="button" className={btn} onClick={() => void openFile()}>
              Abrir arquivo…
            </button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-enemy">
              {error}
            </p>
          )}

          {shared && (
            <div className="flex flex-col gap-3 border-t border-line pt-3" aria-label="Prévia da Pool recebida">
              <div>
                <h3 className="font-display text-lg font-semibold">
                  Pool de {shared.nickname}
                  {shared.riotId && <span className="ml-2 text-sm font-normal text-mist">{shared.riotId}</span>}
                </h3>
                <p className="text-sm text-mist">{total} {total === 1 ? 'campeão' : 'campeões'} no total</p>
              </div>
              <div className="flex flex-col gap-1.5">
                {ROLES.filter((r) => shared.pool[r].length > 0).map((r) => (
                  <div key={r} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-mist">{ROLE_LABEL[r]}</span>
                    <div className="flex flex-wrap gap-1">
                      {shared.pool[r].map((e) => (
                        <ChampionIcon key={e.championId} id={e.championId} size={30} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <fieldset className="flex flex-col gap-1.5 text-sm">
                <legend className="mb-1 text-mist">O que fazer com ela?</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} className="accent-[var(--color-gold)]" />
                  Criar um perfil novo: {shared.nickname}
                </label>
                {target && (
                  <>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} className="accent-[var(--color-gold)]" />
                      Juntar com o perfil {target.nickname}: adiciona só o que falta ({added} {added === 1 ? 'campeão novo' : 'campeões novos'}), sem mexer no que você já tem
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-[var(--color-gold)]" />
                      Substituir a Pool de {target.nickname} por esta
                    </label>
                  </>
                )}
              </fieldset>

              <div className="flex items-center gap-3">
                <button type="button" className={btnGold} onClick={() => onApply(mode, shared)}>
                  Importar
                </button>
                <span className="text-xs text-mist">Nada é salvo até você clicar em “Salvar perfil”.</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
