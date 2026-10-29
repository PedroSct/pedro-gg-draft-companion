import { ChampionIcon } from './Icons'

function Group({ ids, side }: { ids: number[]; side: 'ally' | 'enemy' }) {
  const slots = Array.from({ length: 5 }, (_, i) => ids[i] ?? 0)
  const label = side === 'ally' ? 'Bans do seu time' : 'Bans do time inimigo'
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${side === 'enemy' ? 'flex-row-reverse' : ''}`}>
      <span className={`shrink-0 whitespace-nowrap text-xs ${side === 'ally' ? 'text-ally' : 'text-enemy'}`}>
        {side === 'ally' ? 'Seus bans' : 'Bans inimigos'}
      </span>
      <ul className="flex shrink-0 gap-1" aria-label={label}>
        {slots.map((id, i) => (
          <li key={i} className="shrink-0">
            {id > 0 ? (
              <ChampionIcon id={id} size={30} dim />
            ) : (
              <div className="chamfer-sm h-[30px] w-[30px] border border-dashed border-line bg-deck" aria-hidden="true" />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function BansBar({ allies, enemies }: { allies: number[]; enemies: number[] }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-line bg-panel/70 px-3 py-2">
      <Group ids={allies} side="ally" />
      <Group ids={enemies} side="enemy" />
    </div>
  )
}
