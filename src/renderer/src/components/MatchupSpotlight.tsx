import { useEffect, useState } from 'react'
import type { LaneMatchup } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { useFocus } from '../lib/useFocus'
import { pct, ROLE_SHORT } from '../lib/format'
import { ChampionIcon, useChampionName } from './Icons'

function verdict(wr: number): { text: string; cls: string } {
  if (wr >= 0.53) return { text: 'Vantagem', cls: 'border-ally/60 bg-ally/10 text-ally' }
  if (wr <= 0.47) return { text: 'Desvantagem', cls: 'border-enemy/60 bg-enemy/10 text-enemy' }
  return { text: 'Equilibrado', cls: 'border-line bg-panel text-mist' }
}

function Side({ id, color, ring, label }: { id: number; color: string; ring: string; label: string }) {
  const name = useChampionName(id)
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span className="spot-side rounded-xl" style={{ ['--spot-color' as string]: color }}>
        {id > 0 ? (
          <ChampionIcon id={id} size={64} className={`rounded-xl ring-2 ${ring}`} />
        ) : (
          <span className="grid h-16 w-16 place-items-center rounded-xl border border-dashed border-line bg-deck font-display text-2xl text-dim" aria-hidden="true">
            ?
          </span>
        )}
      </span>
      <span className="max-w-full truncate font-display text-lg font-semibold leading-none">{name || 'Aguardando'}</span>
      <span className="text-[11px] uppercase tracking-wide text-mist">{label}</span>
    </div>
  )
}

/**
 * Seu confronto de rota em destaque: o seu campeão (ou o em foco) contra o oponente da rota, com o quanto você vence dele.
 * O oponente vem do draft; sem ele, dá para simular um pela busca (ex.: Caitlyn no ADC) e a build/runas se ajustam.
 */
export function MatchupSpotlight() {
  const draft = useApp((s) => s.draft)
  const focus = useFocus()
  const sim = useApp((s) => s.simEnemyId)
  const setSim = useApp((s) => s.setSimEnemy)
  const [m, setM] = useState<LaneMatchup | null>(null)
  const enemySig = draft ? draft.enemies.map((e) => `${e.championId}${e.status}`).join(',') : ''
  const championId = focus?.championId
  const role = focus?.role ?? null
  const forLocal = focus?.forLocal ?? false

  useEffect(() => {
    if (championId === undefined || !role || !forLocal) {
      setM(null)
      return
    }
    let cancelled = false
    window.api
      .getLaneMatchup({ championId, role, enemyId: sim })
      .then((r) => !cancelled && setM(r))
      .catch(() => !cancelled && setM(null))
    return () => {
      cancelled = true
    }
  }, [championId, role, forLocal, sim, enemySig])

  const enemyName = useChampionName(m?.enemyId ?? 0)
  if (!draft || !focus || !forLocal) return null
  const v = m?.winrate != null ? verdict(m.winrate) : null

  return (
    <section aria-label="Seu confronto de rota" className="spot-card rounded-2xl border border-line bg-panel/70 p-3 shadow-card">
      <div className="flex items-center gap-3">
        <Side id={focus.championId} color="var(--color-ally)" ring="ring-ally" label={focus.source === 'local' ? 'Você' : 'Em foco'} />
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className="spot-vs font-display text-2xl font-bold tracking-widest text-gold">VS</span>
          {role && <span className="text-[11px] uppercase tracking-wide text-dim">{ROLE_SHORT[role]}</span>}
        </div>
        <Side id={m?.enemyId ?? 0} color="var(--color-enemy)" ring="ring-enemy" label={m?.enemyId ? (m.simulated ? 'Simulado' : 'Oponente de rota') : 'Oponente'} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2 text-sm">
        {m?.enemyId ? (
          <>
            {v && m.winrate != null ? (
              <>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${v.cls}`}>{v.text}</span>
                <span className="text-mist">
                  Contra {enemyName} você vence <span className="num text-snow">{pct(m.winrate)}</span> ({m.games} jogos)
                </span>
              </>
            ) : (
              <span className="text-mist">Poucos dados do confronto contra {enemyName}: use a build como guia.</span>
            )}
            {m.simulated && (
              <button type="button" className="text-xs text-mist underline-offset-4 hover:text-snow hover:underline" onClick={() => setSim(null)}>
                Limpar simulação
              </button>
            )}
          </>
        ) : (
          <span className="text-center text-mist">
            Seu oponente de rota ainda não está claro. Use <span className="text-snow">Buscar campeão › Oponente</span> para simular (ex.: Caitlyn no ADC) e ver build e runas contra ele.
          </span>
        )}
      </div>
    </section>
  )
}
