import { useEffect, useState } from 'react'
import type { Role } from '../../../shared/types'
import type { BuildSituation, ChampionBuild } from '../../../shared/dataTypes'
import { buildGamePlan, type PlanPhase } from '../../../shared/gamePlan'
import { ROLE_LABEL } from '../lib/format'
import { ChampionIcon, ItemIcon, useChampionName } from './Icons'

function Phase({ p }: { p: PlanPhase }) {
  return (
    <li className="border border-line bg-panel/70 p-3" aria-label={p.title}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-lg font-semibold text-gold">{p.title}</h4>
        <span className="text-xs text-mist">{p.levels}</span>
      </div>
      {p.skills.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-mist">Habilidades</p>
          <ol className="mt-1 flex flex-wrap gap-1" aria-label={`Habilidades a evoluir, ${p.levels}`}>
            {p.skills.map((s) => (
              <li key={s.level} className="num flex items-center gap-1 bg-raised px-1.5 py-0.5 text-xs" title={`Nível ${s.level}`}>
                <span className="text-dim">{s.level}</span>
                <span className={s.key === 'R' ? 'text-gold' : 'text-snow'}>{s.key}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {p.items.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-mist">Comprar</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {p.items.map((id, i) => (
              <li key={`${id}-${i}`}>
                <ItemIcon id={id} size={32} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.situational.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-mist">Conforme a partida</p>
          <ul className="mt-1 flex flex-col gap-1">
            {p.situational.map((s) => (
              <li key={s.itemId} className="flex items-center gap-2 text-xs text-mist">
                <ItemIcon id={s.itemId} size={24} />
                <span>{s.when}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.notes.map((n) => (
        <p key={n} className="mt-2 text-xs text-snow">
          {n}
        </p>
      ))}
    </li>
  )
}

/** Plano de jogo (início, meio e fim) do campeão escolhido: para quem não usa o overlay e dá alt+tab. */
export function GamePlan({ championId, role, compact = false }: { championId: number; role: Role | null; compact?: boolean }) {
  const name = useChampionName(championId)
  const [build, setBuild] = useState<ChampionBuild | null>(null)
  const [situation, setSituation] = useState<BuildSituation | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!role) {
      setBuild(null)
      setDone(true)
      return
    }
    let cancelled = false
    setDone(false)
    Promise.all([window.api.getBuild({ championId, role }).catch(() => null), window.api.getBuildSituation({ championId, role }).catch(() => null)]).then(([b, s]) => {
      if (cancelled) return
      setBuild(b)
      setSituation(s)
      setDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [championId, role])

  const plan = buildGamePlan(build, situation)
  if (!done) return null
  if (!plan) {
    return compact ? (
      <p className="text-sm text-mist">Sem dados de build de {name} para montar o plano de jogo.</p>
    ) : null
  }

  return (
    <section aria-label="Plano de jogo" className="rounded-2xl border border-gold/30 bg-gold/5 p-3">
      <header className="flex items-center gap-3">
        <ChampionIcon id={championId} size={40} />
        <div className="min-w-0">
          <h3 className="font-display text-xl font-semibold text-gold">Plano de jogo</h3>
          <p className="text-xs text-mist">
            {name}
            {role ? `, ${ROLE_LABEL[role]}` : ''}. Baseado nas partidas de quem venceu com ele.
          </p>
        </div>
      </header>
      <ol className="mt-3 grid grid-cols-3 gap-3 max-[1000px]:grid-cols-1">
        {plan.phases.map((p) => (
          <Phase key={p.id} p={p} />
        ))}
      </ol>
    </section>
  )
}
