import { useEffect, useState } from 'react'
import { useApp } from '../store/useApp'
import { btn, btnDanger, btnGold } from '../lib/ui'
import { useChampionName } from './Icons'

/**
 * Escolher ou banir pelo app. Só aparece na vez da pessoa e só age quando ela clica:
 * - escolher: "Selecionar" marca o campeão no cliente (dá para trocar); "Travar" pede confirmação, pois não desfaz;
 * - banir: "Banir" pede confirmação e então bane.
 * O app nunca decide nada sozinho.
 */
export function DraftActButton({ championId, type, compact = false }: { championId: number; type: 'pick' | 'ban'; compact?: boolean }) {
  const turn = useApp((s) => s.draft?.turn ?? null)
  const name = useChampionName(championId)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Trocou o campeão ou a vez passou: volta ao começo.
  useEffect(() => {
    setConfirm(false)
    setMsg(null)
  }, [championId, turn?.id, turn?.type])

  if (!turn || turn.type !== type) {
    return msg ? (
      <p role="status" className={`text-xs ${msg.ok ? 'text-ally' : 'text-enemy'}`}>
        {msg.text}
      </p>
    ) : null
  }

  const selected = turn.championId === championId

  async function run(kind: 'hover' | 'lock'): Promise<void> {
    setBusy(true)
    setMsg(null)
    try {
      const res = await window.api.draftAct({ kind, type, championId })
      setMsg({ ok: res.ok, text: res.message })
      if (kind === 'lock') setConfirm(false)
    } catch {
      setMsg({ ok: false, text: 'Não consegui falar com o cliente do LoL.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'mt-1'}`}>
      {confirm ? (
        <>
          <span className="text-sm text-snow">{type === 'ban' ? `Banir ${name}?` : `Travar ${name}? Não dá para desfazer.`}</span>
          <button type="button" className={type === 'ban' ? btnDanger : btnGold} disabled={busy} onClick={() => void run('lock')}>
            {busy ? 'Enviando…' : type === 'ban' ? 'Sim, banir' : 'Sim, travar'}
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => setConfirm(false)}>
            Cancelar
          </button>
        </>
      ) : type === 'ban' ? (
        <button type="button" className={btnDanger} disabled={busy} onClick={() => setConfirm(true)} aria-label={`Banir ${name}`}>
          Banir
        </button>
      ) : (
        <>
          {!selected && (
            <button type="button" className={btn} disabled={busy} onClick={() => void run('hover')} aria-label={`Selecionar ${name} no cliente`}>
              {busy ? 'Enviando…' : 'Selecionar no cliente'}
            </button>
          )}
          <button type="button" className={btnGold} disabled={busy} onClick={() => setConfirm(true)} aria-label={`Travar ${name}`}>
            Travar
          </button>
        </>
      )}
      {msg && (
        <span role="status" className={`text-xs ${msg.ok ? 'text-ally' : 'text-enemy'}`}>
          {msg.text}
        </span>
      )}
    </div>
  )
}
