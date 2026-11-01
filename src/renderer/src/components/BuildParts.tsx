import type { ChampionBuild, SkillKey, SpellInfo } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { ItemIcon, SafeImg } from './Icons'

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

export function SkillOrder({ build, spells, hideTitle = false }: { build: ChampionBuild; spells: SpellInfo[]; hideTitle?: boolean }) {
  if (!build.skillOrder) return null
  const { priority, levels } = build.skillOrder
  const bySlot = (k: SkillKey): SpellInfo | undefined => spells.find((s) => s.slot === k)

  return (
    <div>
      {!hideTitle && <h3 className="mb-2 text-sm text-mist">Ordem das habilidades</h3>}
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

export function ItemRow({ title, ids, chain = false }: { title: string; ids: number[]; chain?: boolean }) {
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

export function SituationalItem({ id, when }: { id: number; when: string }) {
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

