import { useEffect, useState } from 'react'
import type { Role } from '../../../shared/types'
import type { BuildSituation, ChampionBuild, SkillKey, SpellInfo } from '../../../shared/dataTypes'
import { buildGamePlan, type PlanPhase } from '../../../shared/gamePlan'
import { useApp } from '../store/useApp'
import { ROLE_LABEL, splashUrl } from '../lib/format'
import { SPELL_NAME } from '../lib/spells'
import { ChampionIcon, ItemIcon, useChampionName } from './Icons'
import { SituationalItem, SkillOrder } from './BuildParts'

const SKILLS: SkillKey[] = ['Q', 'W', 'E', 'R']

/** Aparência de cada momento: número, cor da faixa e do fundo das células da grade. */
const LOOK = {
  early: { n: 1, bar: 'bg-ally', text: 'text-ally', tint: 'bg-ally/10', head: 'bg-ally/15 text-ally' },
  mid: { n: 2, bar: 'bg-gold', text: 'text-gold', tint: 'bg-gold/10', head: 'bg-gold/15 text-gold' },
  late: { n: 3, bar: 'bg-snow/70', text: 'text-snow', tint: 'bg-snow/5', head: 'bg-snow/10 text-snow' }
} as const

function ItemLine({ id }: { id: number }) {
  const name = useApp((s) => s.catalog?.items[String(id)]?.name ?? `Item ${id}`)
  return (
    <li className="flex items-center gap-2.5">
      <ItemIcon id={id} size={32} />
      <span className="min-w-0 truncate text-sm text-snow">{name}</span>
    </li>
  )
}

function Phase({ p }: { p: PlanPhase }) {
  const look = LOOK[p.id]
  return (
    <li aria-label={p.title} className="flex flex-col overflow-hidden rounded-xl border border-line bg-panel/70">
      <span className={`h-1 ${look.bar}`} aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className={`num grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${look.head}`}>
            {look.n}
          </span>
          <div className="min-w-0">
            <h4 className="font-display text-xl font-semibold leading-none text-snow">{p.title}</h4>
            <p className="mt-0.5 text-xs text-mist">{p.levels}</p>
          </div>
        </div>

        {p.notes.length > 0 && (
          <ul className="flex flex-col gap-1">
            {p.notes.map((n) => (
              <li key={n} className={`border-l-2 pl-2 text-sm ${look.text}`} style={{ borderColor: 'currentColor' }}>
                <span className="text-snow">{n}</span>
              </li>
            ))}
          </ul>
        )}

        {p.items.length > 0 && (
          <div>
            <h5 className="mb-1.5 text-xs uppercase tracking-wide text-dim">Comprar, nesta ordem</h5>
            <ol className="flex flex-col gap-1.5">
              {p.items.map((id, i) => (
                <ItemLine key={`${id}-${i}`} id={id} />
              ))}
            </ol>
          </div>
        )}

        {p.situational.length > 0 && (
          <div>
            <h5 className="mb-1.5 text-xs uppercase tracking-wide text-dim">Conforme a partida</h5>
            <ul className="flex flex-col gap-2">
              {p.situational.map((s) => (
                <SituationalItem key={s.itemId} id={s.itemId} when={s.when} />
              ))}
            </ul>
          </div>
        )}

        {p.tips.length > 0 && (
          <div className="mt-auto border-t border-line/70 pt-2.5">
            <h5 className="mb-1.5 text-xs uppercase tracking-wide text-dim">Como agir</h5>
            <ul className="flex flex-col gap-1.5">
              {p.tips.map((t) => (
                <li key={t} className="flex gap-2 text-sm text-mist">
                  <span aria-hidden="true" className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${look.bar}`} />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  )
}

/** Grade nível x habilidade (como na aba Meta), com o início, o meio e o fim da partida em faixas coloridas. */
function PlanGrid({ levels }: { levels: SkillKey[] }) {
  const bands: { id: 'early' | 'mid' | 'late'; from: number; to: number; label: string }[] = [
    { id: 'early', from: 1, to: 5, label: 'Início' },
    { id: 'mid', from: 6, to: 11, label: 'Meio' },
    { id: 'late', from: 12, to: 18, label: 'Fim' }
  ]
  const bandOf = (lv: number): 'early' | 'mid' | 'late' => (lv <= 5 ? 'early' : lv <= 11 ? 'mid' : 'late')
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-center" aria-label="Habilidade a evoluir em cada nível, por momento da partida">
        <thead>
          <tr>
            <th className="w-6" />
            {bands.map((b) => (
              <th key={b.id} scope="colgroup" colSpan={Math.min(b.to, levels.length) - b.from + 1} className={`px-1 py-0.5 text-[11px] font-medium uppercase tracking-wide ${LOOK[b.id].head}`}>
                {b.label}
              </th>
            ))}
          </tr>
          <tr>
            <th />
            {levels.map((_, i) => (
              <th key={i} scope="col" className="num h-4 text-[11px] font-normal text-dim">
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SKILLS.map((k) => (
            <tr key={k}>
              <th scope="row" className="num pr-1 text-left text-sm font-semibold text-mist">
                {k}
              </th>
              {levels.map((l, i) => (
                <td
                  key={i}
                  className={`num h-[22px] text-xs ${l === k ? (k === 'R' ? 'bg-gold font-semibold text-night' : 'bg-ally/80 font-semibold text-night') : LOOK[bandOf(i + 1)].tint}`}
                >
                  {l === k ? i + 1 : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Plano de jogo (início, meio e fim) do campeão escolhido: para quem não usa o overlay e dá alt+tab. */
export function GamePlan({ championId, role, compact = false }: { championId: number; role: Role | null; compact?: boolean }) {
  const name = useChampionName(championId)
  const champ = useApp((s) => s.champById.get(championId))
  const [build, setBuild] = useState<ChampionBuild | null>(null)
  const [situation, setSituation] = useState<BuildSituation | null>(null)
  const [spells, setSpells] = useState<SpellInfo[]>([])
  const [done, setDone] = useState(false)
  const key = champ?.key

  useEffect(() => {
    if (!role) {
      setBuild(null)
      setDone(true)
      return
    }
    let cancelled = false
    setDone(false)
    Promise.all([
      window.api.getBuild({ championId, role }).catch(() => null),
      window.api.getBuildSituation({ championId, role }).catch(() => null),
      key ? window.api.getSpells(key).catch(() => [] as SpellInfo[]) : Promise.resolve([] as SpellInfo[])
    ]).then(([b, s, sp]) => {
      if (cancelled) return
      setBuild(b)
      setSituation(s)
      setSpells(sp)
      setDone(true)
    })
    return () => {
      cancelled = true
    }
  }, [championId, role, key])

  const plan = buildGamePlan(build, situation, role)
  if (!done) return null
  if (!plan || !build) {
    return compact ? <p className="text-sm text-mist">Sem dados de build de {name} para montar o plano de jogo.</p> : null
  }
  const levels = build.skillOrder?.levels

  return (
    <section aria-label="Plano de jogo" className="overflow-hidden rounded-2xl border border-gold/30 bg-panel/70 shadow-card">
      <header className="relative flex flex-wrap items-center gap-3 overflow-hidden border-b border-line px-4 py-3">
        {champ && <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-cover bg-top opacity-25" style={{ backgroundImage: `url("${splashUrl(champ.key)}")` }} />}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-panel via-panel/80 to-transparent" />
        <ChampionIcon id={championId} size={52} className="relative" />
        <div className="relative min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-gold">Plano de jogo</p>
          <h3 className="truncate font-display text-3xl font-semibold leading-none">{name}</h3>
          <p className="mt-1 text-xs text-mist">{role ? `${ROLE_LABEL[role]}. ` : ''}Itens e habilidades das partidas vencidas com ele.</p>
        </div>
        {plan.spells && (
          <p className="relative text-sm text-mist">
            Feitiços <span className="text-snow">{plan.spells.map((id) => SPELL_NAME[id] ?? `#${id}`).join(' + ')}</span>
          </p>
        )}
      </header>

      <div className="flex flex-col gap-4 p-4">
        {(levels || plan.priority.length > 0) && (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-deck/60 p-3.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h4 className="text-sm text-snow">Ordem das habilidades</h4>
              {plan.ultLevels.length > 0 && <p className="text-xs text-mist">Ultimate nos níveis {plan.ultLevels.join(', ')}</p>}
            </div>
            {build.skillOrder && <SkillOrder build={{ ...build, skillOrder: { priority: build.skillOrder.priority } }} spells={spells} hideTitle />}
            {levels && levels.length > 0 && <PlanGrid levels={levels} />}
          </div>
        )}

        <ol className="grid grid-cols-3 gap-3 max-[1100px]:grid-cols-1">
          {plan.phases.map((p) => (
            <Phase key={p.id} p={p} />
          ))}
        </ol>
        {role && <p className="text-xs text-dim">As dicas de “Como agir” são orientações gerais da rota, não vêm dos dados de meta.</p>}
      </div>
    </section>
  )
}
