import { useEffect, useMemo, useState } from 'react'
import { ROLES, type Pool } from '../../../shared/dataTypes'
import type { PoolCandidate, PoolSuggestResult } from '../../../shared/poolImport'
import type { Role } from '../../../shared/types'
import { ROLE_LABEL } from '../lib/format'
import { btn, btnGold } from '../lib/ui'
import { ChampionIcon, Stars, useChampionName } from './Icons'

interface Props {
  /** Pool atual do perfil aberto no editor (para marcar quem já está nela) */
  pool: Pool
  /** rotas principais atuais do perfil (só preenche se estiver vazio) */
  mainRoles: Role[]
  onApply: (picked: PoolCandidate[], opts: { updateComfort: boolean; mainRoles: Role[] | null }) => void
  onClose: () => void
}

const keyOf = (c: PoolCandidate): string => `${c.championId}|${c.role}`

function Row({ c, checked, inPool, onToggle }: { c: PoolCandidate; checked: boolean; inPool: boolean; onToggle: () => void }) {
  const name = useChampionName(c.championId)
  return (
    <li className="flex items-center gap-3 py-1">
      <input type="checkbox" aria-label={`Adicionar ${name}`} checked={checked} onChange={onToggle} className="accent-[var(--color-gold)]" />
      <ChampionIcon id={c.championId} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-snow">
          {name}
          {inPool && <span className="ml-2 rounded-full bg-ally/15 px-1.5 text-[11px] text-ally">já na Pool</span>}
        </div>
        <div className="truncate text-xs text-mist">{c.reason}</div>
      </div>
      <Stars value={c.comfort} label={`Conforto sugerido para ${name}`} />
    </li>
  )
}

/** Sugere a Pool a partir das partidas recentes e da maestria da conta que está logada no cliente do LoL. */
export function AccountPoolDialog({ pool, mainRoles, onApply, onClose }: Props) {
  const [result, setResult] = useState<PoolSuggestResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [updateComfort, setUpdateComfort] = useState(false)
  const [setMain, setSetMain] = useState(true)

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

  async function load(): Promise<void> {
    setLoading(true)
    try {
      const r = await window.api.suggestPoolFromAccount()
      setResult(r)
      if (r.ok) {
        const start = new Set<string>()
        for (const role of ROLES) {
          for (const c of r.suggestion.byRole[role]) {
            if (!pool[role].some((e) => e.championId === c.championId)) start.add(keyOf(c))
          }
        }
        setPicked(start)
      }
    } catch {
      setResult({ ok: false, message: 'Não consegui falar com o cliente do LoL.' })
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const all = useMemo(() => (result?.ok ? ROLES.flatMap((r) => result.suggestion.byRole[r]) : []), [result])
  const chosen = all.filter((c) => picked.has(keyOf(c)))
  const suggestedMain = result?.ok && mainRoles.length === 0 ? result.suggestion.mainRoles : []

  function toggle(c: PoolCandidate): void {
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(keyOf(c))) n.delete(keyOf(c))
      else n.add(keyOf(c))
      return n
    })
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-night/80 p-6">
      <div role="dialog" aria-modal="true" aria-label="Importar da conta" className="w-full max-w-2xl border border-line bg-deck">
        <div className="flex items-center border-b border-line px-5 py-3">
          <h2 className="font-display text-xl font-semibold">Importar a Pool da sua conta</h2>
          <button type="button" className={`${btn} ml-auto`} onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {loading && <p role="status" className="text-sm text-mist">Lendo suas partidas e a maestria no cliente do LoL…</p>}
          {!loading && result && !result.ok && (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-sm text-enemy">{result.message}</p>
              <div>
                <button type="button" className={btn} onClick={() => void load()}>
                  Tentar de novo
                </button>
              </div>
            </div>
          )}

          {!loading && result?.ok && (
            <>
              <p className="text-sm text-mist">
                Conta lida no cliente: <span className="text-snow">{result.account ?? 'conta logada'}</span>. Usei {result.suggestion.gamesUsed}{' '}
                {result.suggestion.gamesUsed === 1 ? 'partida recente' : 'partidas recentes'} (normais e ranqueadas) e os pontos de maestria. O
                conforto é uma sugestão: pesa partidas na rota, maestria e taxa de vitória, e você ajusta depois.
              </p>
              {all.length === 0 && <p className="text-sm text-mist">Não achei campeões suficientes para sugerir. Jogue mais algumas partidas e tente de novo.</p>}
              {ROLES.filter((r) => result.suggestion.byRole[r].length > 0).map((r) => (
                <section key={r} aria-label={ROLE_LABEL[r]} className="border-t border-line pt-2">
                  <h3 className="mb-1 font-display text-base font-semibold">{ROLE_LABEL[r]}</h3>
                  <ul>
                    {result.suggestion.byRole[r].map((c) => (
                      <Row key={keyOf(c)} c={c} checked={picked.has(keyOf(c))} inPool={pool[r].some((e) => e.championId === c.championId)} onToggle={() => toggle(c)} />
                    ))}
                  </ul>
                </section>
              ))}

              <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={updateComfort} onChange={(e) => setUpdateComfort(e.target.checked)} className="accent-[var(--color-gold)]" />
                  Também atualizar o conforto de quem já está na Pool (marcado, só dos campeões da lista)
                </label>
                {suggestedMain.length > 0 && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={setMain} onChange={(e) => setSetMain(e.target.checked)} className="accent-[var(--color-gold)]" />
                    Definir as rotas principais do perfil: {suggestedMain.map((r) => ROLE_LABEL[r]).join(' e ')}
                  </label>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={btnGold}
                  disabled={chosen.length === 0 && !(setMain && suggestedMain.length > 0)}
                  onClick={() => onApply(chosen, { updateComfort, mainRoles: setMain && suggestedMain.length > 0 ? suggestedMain : null })}
                >
                  Adicionar à Pool
                </button>
                <span className="text-xs text-mist">Nada é salvo até você clicar em “Salvar perfil”. O que você já tem não é apagado.</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
