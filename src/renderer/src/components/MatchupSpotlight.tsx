import { useEffect, useState } from 'react'
import type { DuoInfo, LaneMatchup } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { useFocus } from '../lib/useFocus'
import { pct, ROLE_SHORT } from '../lib/format'
import { ChampionIcon, useChampionName } from './Icons'

function verdict(wr: number): { text: string; cls: string } {
  if (wr >= 0.53) return { text: 'Vantagem', cls: 'border-good/50 text-good' }
  if (wr <= 0.47) return { text: 'Desvantagem', cls: 'border-enemy/50 text-enemy' }
  return { text: 'Equilibrado', cls: 'border-line text-mist' }
}

function Side({ id, ring, label, size }: { id: number; ring: string; label: string; size: number }) {
  const name = useChampionName(id)
  return (
    <div className="flex w-32 shrink-0 flex-col items-center gap-2 text-center">
      {id > 0 ? (
        <ChampionIcon id={id} size={size} className={`rounded-xl ring-2 ${ring}`} />
      ) : (
        <span className="grid place-items-center rounded-xl border border-dashed border-line font-display text-2xl text-dim" style={{ width: size, height: size }} aria-hidden="true">
          ?
        </span>
      )}
      <span className="max-w-full truncate font-semibold">{name || 'Aguardando'}</span>
      <span className="-mt-1.5 text-[11px] uppercase tracking-wider text-dim">{label}</span>
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

function DuoCard({ duo, myId, compact = false }: { duo: DuoInfo; myId: number; compact?: boolean }) {
  const mine = duo.partnerRole === 'BOTTOM' ? 'Seu atirador' : 'Seu suporte'
  return (
    <div aria-label="Combo da dupla" className={`${compact ? 'mt-4 pt-3' : 'mt-6 pt-4'} border-t border-line`}>
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

function Points({ strengths, weaknesses, compact = false }: { strengths: string[]; weaknesses: string[]; compact?: boolean }) {
  if (!strengths.length && !weaknesses.length) return null
  const list = (items: string[], mark: string, empty: string) =>
    items.length ? (
      <ul>
        {items.map((t) => (
          <li key={t} className="border-b border-line py-2 text-sm text-snow">
            {mark} {t}
          </li>
        ))}
      </ul>
    ) : (
      <p className="border-b border-line py-2 text-sm text-dim">{empty}</p>
    )
  return (
    <div className={`${compact ? 'mt-4' : 'mt-6'} grid grid-cols-2 gap-10 max-[640px]:grid-cols-1 max-[640px]:gap-5`}>
      <div>
        <h3 className="border-b border-line pb-2 text-xs font-semibold uppercase tracking-wider text-good">Pontos fortes</h3>
        {list(strengths, '+', 'Nada se destaca nos dados.')}
      </div>
      <div>
        <h3 className="border-b border-line pb-2 text-xs font-semibold uppercase tracking-wider text-enemy">Pontos fracos</h3>
        {list(weaknesses, '−', 'Nenhum ponto fraco claro.')}
      </div>
    </div>
  )
}

/**
 * Seu confronto de rota em destaque: o seu campeão (ou o em foco) contra o oponente da rota, com o quanto você vence dele.
 * O oponente vem do draft; sem ele, dá para simular um pela busca (ex.: Caitlyn no ADC) e a build/runas se ajustam.
 */
/** compact: versão menor (etapas de Picks e Build). points: mostra também os pontos fortes e fracos (padrão: só na versão grande). A dupla da rota aparece sempre. */
export function MatchupSpotlight({ compact = false, points = !compact }: { compact?: boolean; points?: boolean } = {}) {
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

  const size = compact ? 56 : 96
  const mine = m?.winrate != null ? m.winrate : null
  return (
    <section aria-label="Seu confronto de rota" className="spot-card">
      <div className="flex items-center justify-center gap-8 max-[700px]:gap-3">
        <Side id={focus.championId} ring="ring-ally" label={focus.source === 'local' ? 'Você' : 'Em foco'} size={size} />
        <div className="min-w-0 max-w-md flex-1">
          {m?.enemyId && v && mine != null ? (
            <>
              <div className="flex items-center justify-between">
                <span className="num text-2xl font-semibold text-ally">{Math.round(mine * 100)}%</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${v.cls}`}>{v.text}</span>
                <span className="num text-2xl font-semibold text-enemy">{Math.round((1 - mine) * 100)}%</span>
              </div>
              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full" aria-hidden="true">
                <span className="bg-ally" style={{ width: `${mine * 100}%` }} />
                <span className="bg-enemy" style={{ width: `${(1 - mine) * 100}%` }} />
              </div>
              <p className="mt-2 text-center text-xs text-dim">
                {role ? `${ROLE_SHORT[role]} · ` : ''}Contra {enemyName} você vence <span className="num text-snow">{pct(mine)}</span> ({m.games} jogos)
              </p>
            </>
          ) : m?.enemyId ? (
            <p className="text-center text-sm text-mist">Poucos dados do confronto contra {enemyName}: use a build como guia.</p>
          ) : (
            <p className="text-center text-sm text-mist">
              Seu oponente de rota ainda não está claro. Use <span className="text-snow">Buscar campeão › Oponente</span> para simular (ex.: Caitlyn no ADC) e ver build e runas contra ele.
            </p>
          )}
          {m?.simulated && (
            <p className="mt-1 text-center">
              <button type="button" className="text-xs text-mist underline-offset-4 hover:text-snow hover:underline" onClick={() => setSim(null)}>
                Limpar simulação
              </button>
            </p>
          )}
        </div>
        <Side id={m?.enemyId ?? 0} ring="ring-enemy" label={m?.enemyId ? (m.simulated ? 'Simulado' : 'Oponente de rota') : 'Oponente'} size={size} />
      </div>
      {m?.duo && <DuoCard duo={m.duo} myId={focus.championId} compact={compact} />}
      {points && m && <Points strengths={m.strengths ?? []} weaknesses={m.weaknesses ?? []} compact={compact} />}
    </section>
  )
}
