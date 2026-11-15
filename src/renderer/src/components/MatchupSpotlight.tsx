import { useEffect, useState } from 'react'
import type { DuoInfo, LaneMatchup } from '../../../shared/dataTypes'
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


function MiniChamp({ id, ring }: { id: number | null; ring: string }) {
  const name = useChampionName(id ?? 0)
  return (
    <span className="flex w-14 flex-col items-center gap-1">
      {id ? (
        <ChampionIcon id={id} size={36} className={`rounded-lg ring-2 ${ring}`} />
      ) : (
        <span className="grid h-9 w-9 place-items-center rounded-lg border border-dashed border-line bg-deck text-dim" aria-hidden="true">
          ?
        </span>
      )}
      <span className="max-w-full truncate text-[10px] text-mist">{name || 'Aguardando'}</span>
    </span>
  )
}

function DuoCard({ duo, myId }: { duo: DuoInfo; myId: number }) {
  const mine = duo.partnerRole === 'BOTTOM' ? 'Seu atirador' : 'Seu suporte'
  return (
    <div aria-label="Combo da dupla" className="mt-3 rounded-xl border border-line bg-deck/60 p-2.5">
      <p className="mb-2 text-center text-[11px] uppercase tracking-wide text-dim">Dupla da rota</p>
      <div className="flex items-center justify-center gap-3">
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-1.5">
            <MiniChamp id={myId} ring="ring-ally" />
            <MiniChamp id={duo.partnerId} ring="ring-ally" />
          </div>
          <span className="text-[11px] text-mist">{duo.partnerId ? mine : `${mine}: aguardando`}</span>
          <span className="num text-xs text-snow">{duo.ourWinrate != null ? `${pct(duo.ourWinrate)} (${duo.ourGames} jogos)` : 'sem amostra'}</span>
        </div>
        <span className="font-display text-sm font-bold text-gold">VS</span>
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-1.5">
            <MiniChamp id={duo.enemyCarryId} ring="ring-enemy" />
            <MiniChamp id={duo.enemySupportId} ring="ring-enemy" />
          </div>
          <span className="text-[11px] text-mist">Dupla inimiga</span>
          <span className="num text-xs text-snow">{duo.enemyWinrate != null ? `${pct(duo.enemyWinrate)} (${duo.enemyGames} jogos)` : 'sem amostra'}</span>
        </div>
      </div>
    </div>
  )
}

function Points({ strengths, weaknesses }: { strengths: string[]; weaknesses: string[] }) {
  if (!strengths.length && !weaknesses.length) return null
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 max-[640px]:grid-cols-1">
      <div className="rounded-xl border border-ally/30 bg-ally/5 p-2.5">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ally">Pontos fortes</h3>
        {strengths.length ? (
          <ul className="space-y-1 text-xs text-snow">
            {strengths.map((t) => (
              <li key={t}>+ {t}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-dim">Nada se destaca nos dados.</p>
        )}
      </div>
      <div className="rounded-xl border border-enemy/30 bg-enemy/5 p-2.5">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-enemy">Pontos fracos</h3>
        {weaknesses.length ? (
          <ul className="space-y-1 text-xs text-snow">
            {weaknesses.map((t) => (
              <li key={t}>− {t}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-dim">Nenhum ponto fraco claro.</p>
        )}
      </div>
    </div>
  )
}

/**
 * Seu confronto de rota em destaque: o seu campeão (ou o em foco) contra o oponente da rota, com o quanto você vence dele.
 * O oponente vem do draft; sem ele, dá para simular um pela busca (ex.: Caitlyn no ADC) e a build/runas se ajustam.
 */
export function MatchupSpotlight({ compact = false }: { compact?: boolean } = {}) {
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
      {!compact && m?.duo && <DuoCard duo={m.duo} myId={focus.championId} />}
      {!compact && m && <Points strengths={m.strengths ?? []} weaknesses={m.weaknesses ?? []} />}
    </section>
  )
}
