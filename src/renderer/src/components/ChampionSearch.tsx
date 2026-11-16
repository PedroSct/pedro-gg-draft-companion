import { useEffect, useMemo, useState } from 'react'
import type { MetaTierRow } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { useFocus } from '../lib/useFocus'
import { pct, ROLE_SHORT } from '../lib/format'
import { btn, input } from '../lib/ui'
import { ChampionIcon } from './Icons'
import { DraftActButton } from './DraftActButton'

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const MAX = 6

/**
 * Busca de campeões dentro do Draft: ver a build (e runas contra o oponente), simular o oponente de rota
 * (ex.: Caitlyn no ADC) e, na sua vez, banir ou escolher. Nada acontece sem clique, e o app confirma antes de banir/travar.
 */
export function ChampionSearch() {
  const draft = useApp((s) => s.draft)
  const catalog = useApp((s) => s.catalog)
  const setPreview = useApp((s) => s.setPreview)
  const setSim = useApp((s) => s.setSimEnemy)
  const sim = useApp((s) => s.simEnemyId)
  const focus = useFocus()
  const [q, setQ] = useState('')
  const [tiers, setTiers] = useState<Map<number, MetaTierRow>>(new Map())
  const role = draft?.localRole ?? focus?.role ?? null
  const turn = draft?.turn ?? null

  useEffect(() => {
    if (!role) {
      setTiers(new Map())
      return
    }
    let cancelled = false
    window.api
      .getMetaTiers(role)
      .then((rows) => !cancelled && setTiers(new Map(rows.map((r) => [r.championId, r]))))
      .catch(() => !cancelled && setTiers(new Map()))
    return () => {
      cancelled = true
    }
  }, [role])

  const taken = useMemo(() => {
    const m = new Map<number, string>()
    if (!draft) return m
    for (const id of draft.bans.allies) m.set(id, 'Banido')
    for (const id of draft.bans.enemies) m.set(id, 'Banido')
    for (const p of draft.allies) if (p.championId > 0 && p.status === 'locked') m.set(p.championId, 'Já escolhido')
    for (const p of draft.enemies) if (p.championId > 0 && p.status === 'locked') m.set(p.championId, 'Já escolhido')
    return m
  }, [draft])

  const results = useMemo(() => {
    const n = norm(q)
    if (!n || !catalog) return []
    const hits = catalog.champions.filter((c) => norm(c.name).includes(n) || norm(c.key).includes(n))
    // quem começa com o texto vem primeiro; depois quem é mais forte na sua rota
    return hits
      .sort((a, b) => Number(norm(b.name).startsWith(n)) - Number(norm(a.name).startsWith(n)) || (tiers.get(b.id)?.score ?? -99) - (tiers.get(a.id)?.score ?? -99) || a.name.localeCompare(b.name))
      .slice(0, MAX)
  }, [q, catalog, tiers])

  if (!draft) return null

  return (
    <section aria-label="Buscar campeão" className="rounded-lg border border-line p-3">
      <div className="flex items-center gap-2">
        <label htmlFor="champ-search" className="shrink-0 text-sm text-snow">
          Buscar campeão
        </label>
        <div className="relative flex-1">
          <input
            id="champ-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Digite o nome (ex.: Caitlyn) para ver build, banir ou escolher"
            className={input}
          />
        </div>
        {q && (
          <button type="button" className={btn} onClick={() => setQ('')} aria-label="Limpar busca">
            Limpar
          </button>
        )}
      </div>

      {sim !== null && (
        <p className="mt-2 text-xs text-mist">
          Oponente simulado ativo.{' '}
          <button type="button" className="underline underline-offset-4 hover:text-snow" onClick={() => setSim(null)}>
            Limpar simulação
          </button>
        </p>
      )}

      {q && results.length === 0 && <p className="mt-2 text-sm text-mist">Nenhum campeão com esse nome.</p>}
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-line/60" aria-label="Resultados da busca">
          {results.map((c) => {
            const row = tiers.get(c.id)
            const why = taken.get(c.id)
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                <ChampionIcon id={c.id} size={36} dim={!!why} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-snow">{c.name}</div>
                  <div className="text-xs text-mist">
                    {why ? (
                      <span className="text-enemy">{why}</span>
                    ) : row && role ? (
                      <>
                        {ROLE_SHORT[role]}: tier {row.tier}, {pct(row.winrate)} de vitórias
                      </>
                    ) : (
                      'Sem dados de meta nesta rota'
                    )}
                  </div>
                </div>
                {!why && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" className={btn} onClick={() => setPreview(c.id)} aria-label={`Ver build de ${c.name}`}>
                      Ver build
                    </button>
                    <button type="button" className={btn} aria-pressed={sim === c.id} onClick={() => setSim(sim === c.id ? null : c.id)} aria-label={`Simular ${c.name} como oponente de rota`}>
                      {sim === c.id ? 'Oponente ✓' : 'Oponente'}
                    </button>
                    {turn && <DraftActButton championId={c.id} type={turn.type} compact />}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
