import type { RunePage } from '../../../shared/dataTypes'
import { useApp } from '../store/useApp'
import { SafeImg } from './Icons'

/** Fragmentos de atributo (não vêm no runesReforged do Data Dragon). */
const SHARD_NAME: Record<number, string> = {
  5001: 'Vida por nível',
  5005: 'Vel. de ataque',
  5007: 'Aceleração de habilidade',
  5008: 'Força adaptável',
  5010: 'Vel. de movimento',
  5011: 'Vida',
  5013: 'Tenacidade e lentidão'
}

function RuneIcon({ id, size, ring = false }: { id: number; size: number; ring?: boolean }) {
  const rune = useApp((s) => s.catalog?.runes?.[String(id)])
  const fallback = (
    <span className="num grid shrink-0 place-items-center rounded-full bg-raised text-[10px] text-dim" style={{ width: size, height: size }} title={`Runa ${id}`}>
      ?
    </span>
  )
  if (!rune) return fallback
  return (
    <SafeImg
      src={rune.iconUrl}
      alt={rune.name}
      title={rune.name}
      className={`shrink-0 rounded-full bg-night/70 ${ring ? 'ring-2 ring-gold/60' : ''}`}
      style={{ width: size, height: size }}
      fallback={fallback}
    />
  )
}

/** Página de runas: árvore principal (com a runa-chave em destaque), secundária e fragmentos. */
export function RunesView({ runes }: { runes: RunePage }) {
  const catalog = useApp((s) => s.catalog)
  const [k, ...rest] = runes.perkIds
  const main = rest.slice(0, 3)
  const sub = runes.perkIds.slice(4, 6)
  const shards = runes.perkIds.slice(6, 9)
  const name = (id: number): string => catalog?.runes?.[String(id)]?.name ?? `#${id}`

  return (
    <div role="group" aria-label="Runas" className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2">
        <RuneIcon id={runes.primaryStyleId} size={22} />
        <RuneIcon id={k} size={46} ring />
        <div className="flex items-center gap-1.5">
          {main.map((id) => (
            <RuneIcon key={id} id={id} size={30} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <RuneIcon id={runes.subStyleId} size={22} />
        {sub.map((id) => (
          <RuneIcon key={id} id={id} size={30} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1" aria-label="Fragmentos">
        {shards.map((id, i) => (
          <span key={`${id}-${i}`} className="rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] text-mist">
            {SHARD_NAME[id] ?? `#${id}`}
          </span>
        ))}
      </div>
      <p className="sr-only">
        Runa-chave {name(k)}. Árvores {name(runes.primaryStyleId)} e {name(runes.subStyleId)}.
      </p>
    </div>
  )
}

const SPELL_FALLBACK: Record<number, string> = { 1: 'Limpar', 3: 'Exaustão', 4: 'Flash', 6: 'Fantasma', 7: 'Curar', 11: 'Golpear', 12: 'Teleporte', 13: 'Clareza', 14: 'Ignição', 21: 'Barreira', 32: 'Marca' }

export function SpellsView({ spells }: { spells: [number, number] }) {
  const summoners = useApp((s) => s.catalog?.summoners)
  return (
    <div role="group" aria-label="Feitiços de invocador" className="flex items-center gap-2">
      {spells.map((id) => {
        const s = summoners?.[String(id)]
        const label = s?.name ?? SPELL_FALLBACK[id] ?? `Feitiço ${id}`
        const tile = (
          <span className="grid h-9 place-items-center rounded-lg bg-raised px-2 text-xs text-mist" title={label}>
            {label}
          </span>
        )
        return s ? (
          <SafeImg key={id} src={s.iconUrl} alt={label} title={label} className="h-9 w-9 shrink-0 rounded-lg bg-raised object-cover" fallback={tile} />
        ) : (
          <span key={id}>{tile}</span>
        )
      })}
    </div>
  )
}
