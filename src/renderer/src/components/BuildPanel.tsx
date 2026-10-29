import { useEffect, useState } from 'react'
import type { ChampionBuild, SkillKey, SpellInfo } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { useFocus } from '../lib/useFocus'
import { ROLE_LABEL, ROLE_SHORT } from '../lib/format'
import { ROLES } from '../../../shared/dataTypes'
import { ChampionIcon, ItemIcon, SafeImg, useChampionName } from './Icons'

const SKILLS: SkillKey[] = ['Q', 'W', 'E', 'R']

function SpellIcon({ spell, slot }: { spell: SpellInfo | undefined; slot: SkillKey }) {
  const letter = (
    <div className="chamfer-sm num grid h-10 w-10 shrink-0 place-items-center bg-raised text-lg text-mist" aria-hidden="true">
      {slot}
    </div>
  )
  if (!spell) return letter
  return (
    <div className="relative shrink-0" title={`${slot}: ${spell.name}`}>
      <SafeImg
        src={spell.iconUrl}
        alt={spell.name}
        className="chamfer-sm h-10 w-10 bg-raised object-cover"
        fallback={letter}
      />
      <span className="num absolute -bottom-1 -right-1 bg-night px-1 text-xs leading-4 text-gold">{slot}</span>
    </div>
  )
}

function SkillOrder({ build, spells }: { build: ChampionBuild; spells: SpellInfo[] }) {
  const { priority, levels } = build.skillOrder
  const bySlot = (k: SkillKey): SpellInfo | undefined => spells.find((s) => s.slot === k)

  return (
    <div>
      <h3 className="mb-2 text-sm text-mist">Ordem das habilidades</h3>
      <div className="flex items-center gap-2" role="img" aria-label={priority.join(' > ')}>
        {priority.map((k, i) => (
          <div key={k} className="flex items-center gap-2" aria-hidden="true">
            {i > 0 && <span className="text-dim">&gt;</span>}
            <SpellIcon spell={bySlot(k)} slot={k} />
          </div>
        ))}
      </div>

      {levels && levels.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="border-separate border-spacing-0.5 text-center" aria-label="Habilidade a evoluir em cada nível">
            <thead>
              <tr>
                <th className="w-5" />
                {levels.map((_, i) => (
                  <th key={i} scope="col" className="num h-4 w-[18px] text-[11px] font-normal text-dim">
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
                      className={`num h-[18px] w-[18px] text-[11px] ${
                        l === k ? (k === 'R' ? 'bg-gold text-night' : 'bg-ally/80 text-night') : 'bg-raised/60'
                      }`}
                    >
                      {l === k ? i + 1 : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ItemRow({ title, ids, chain = false }: { title: string; ids: number[]; chain?: boolean }) {
  if (!ids.length) return null
  return (
    <div>
      <h4 className="mb-1.5 text-xs text-mist">{title}</h4>
      <div className="flex flex-wrap items-center gap-1.5">
        {ids.map((id, i) => (
          <div key={`${id}-${i}`} className="flex items-center gap-1.5">
            {chain && i > 0 && <span className="text-dim" aria-hidden="true">›</span>}
            <ItemIcon id={id} size={42} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SituationalItem({ id, when }: { id: number; when: string }) {
  const name = useApp((s) => s.catalog?.items[String(id)]?.name ?? `Item ${id}`)
  return (
    <li className="flex items-center gap-3">
      <ItemIcon id={id} size={34} />
      <span className="min-w-0 text-sm">
        <span className="block truncate">{name}</span>
        <span className="block truncate text-xs text-mist">{when}</span>
      </span>
    </li>
  )
}

type Status = 'loading' | 'ready' | 'error'

export function BuildPanel() {
  const focus = useFocus()
  const champ = useApp((s) => (focus ? s.champById.get(focus.championId) : undefined))
  const name = useChampionName(focus?.championId ?? 0)
  const setRoleOverride = useApp((s) => s.setRoleOverride)
  const [data, setData] = useState<{ build: ChampionBuild | null; spells: SpellInfo[] }>({ build: null, spells: [] })
  const [status, setStatus] = useState<Status>('loading')

  const championId = focus?.championId
  const role = focus?.role
  const key = champ?.key

  useEffect(() => {
    if (championId === undefined) return
    let cancelled = false
    setStatus('loading')
    Promise.all([
      role ? window.api.getBuild({ championId, role }) : Promise.resolve(null),
      key ? window.api.getSpells(key).catch(() => [] as SpellInfo[]) : Promise.resolve([] as SpellInfo[])
    ])
      .then(([build, spells]) => {
        if (cancelled) return
        setData({ build, spells })
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [championId, role, key])

  if (!focus) {
    return (
      <div className="border border-dashed border-line bg-panel/50 p-5 text-center text-mist">
        A build aparece aqui quando você passar o mouse em um campeão ou travar o pick.
      </div>
    )
  }

  const { build } = data
  const origin =
    focus.source === 'local' ? 'Seu campeão' : focus.source === 'preview' ? 'Opção selecionada' : 'Melhor pick da Pool'

  return (
    <section aria-label="Build" className="border border-line bg-panel/70">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <ChampionIcon id={focus.championId} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-2xl font-semibold leading-none">{name}</h2>
          <p className="mt-1 text-xs text-mist">
            {origin}
            {focus.role ? `, ${ROLE_LABEL[focus.role]}` : ''}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-4">
        {status === 'loading' && <p className="text-mist">Carregando build…</p>}
        {status === 'error' && <p className="text-enemy">Não foi possível carregar a build deste campeão.</p>}

        {status === 'ready' && focus.role === null && (
          <div>
            <p className="mb-2 text-snow">Em qual rota você vai jogar com {name}?</p>
            <div className="flex gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="rounded-sm border border-line bg-panel px-2.5 py-1 text-sm text-mist hover:text-snow"
                  onClick={() => setRoleOverride(r)}
                >
                  {ROLE_SHORT[r]}
                </button>
              ))}
            </div>
          </div>
        )}

        {status === 'ready' && focus.role !== null && !build && (
          <p className="text-mist">
            O dataset de meta não tem build de {name} para {ROLE_LABEL[focus.role]}. Importe um dataset mais completo em
            Configurações.
          </p>
        )}

        {status === 'ready' && build && (
          <>
            <SkillOrder build={build} spells={data.spells} />
            <div className="flex flex-col gap-3">
              <h3 className="text-sm text-mist">Itens</h3>
              <ItemRow title="Inicial" ids={build.items.starting} />
              <ItemRow title="Botas" ids={build.items.boots} />
              <ItemRow title="Principais, na ordem de compra" ids={build.items.core} chain />
              {build.items.situational.length > 0 && (
                <div>
                  <h4 className="mb-1.5 text-xs text-mist">Situacionais</h4>
                  <ul className="flex flex-col gap-2">
                    {build.items.situational.map((s) => (
                      <SituationalItem key={s.itemId} id={s.itemId} when={s.when} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
