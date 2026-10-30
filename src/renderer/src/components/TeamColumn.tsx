import type { DraftPlayer, PickStatus } from '../../../shared/types'
import { selectActiveProfile, useApp } from '../store/useApp'
import { ROLE_SHORT } from '../lib/format'
import { useMemo } from 'react'
import { analyzeComp, type CompWarning } from '../../../shared/comp'
import { ChampionIcon, useChampionName } from './Icons'

interface Props {
  side: 'ally' | 'enemy'
  players: DraftPlayer[]
  localCellId: number
}

const STATUS_TEXT: Record<PickStatus, string> = {
  none: 'Aguardando',
  hovering: 'Escolhendo',
  locked: 'Confirmado'
}

function Row({ side, player, isLocal, index }: { side: 'ally' | 'enemy'; player: DraftPlayer | undefined; isLocal: boolean; index: number }) {
  const ally = side === 'ally'
  const name = useChampionName(player?.championId ?? 0)
  const nickname = useApp((s) => selectActiveProfile(s)?.nickname)
  const status = player?.status ?? 'none'
  const accent = ally ? 'border-ally' : 'border-enemy'

  return (
    <li
      aria-label={`${ally ? 'Aliado' : 'Inimigo'}: ${name || 'sem campeão'}`}
      style={{ ['--d' as string]: `${index * 60}ms` }}
      className={`rise flex items-center gap-3 border-y border-transparent px-3 py-2 ${ally ? 'border-l-2' : 'flex-row-reverse border-r-2 text-right'} ${accent} ${
        isLocal ? 'bg-ally/10' : 'bg-panel/70'
      }`}
    >
      {player && player.championId > 0 ? (
        <ChampionIcon id={player.championId} size={48} dim={status === 'hovering'} />
      ) : (
        <div className="chamfer-sm h-12 w-12 shrink-0 border border-dashed border-line bg-deck" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-xl font-semibold leading-tight">
          {name || <span className="text-dim">Sem campeão</span>}
        </div>
        <div className={`flex items-center gap-2 text-xs text-mist ${ally ? '' : 'justify-end'}`}>
          {isLocal && <span className="font-medium text-ally">{nickname ?? 'Você'}</span>}
          {player?.role && <span>{ROLE_SHORT[player.role]}</span>}
          <span className={status === 'locked' ? 'text-snow' : ''}>{STATUS_TEXT[status]}</span>
        </div>
      </div>
    </li>
  )
}

const WARNING_TEXT: Record<'ally' | 'enemy', Record<CompWarning, string>> = {
  ally: {
    'no-frontline': 'Seu time está sem frontline',
    'mostly-ad': 'Quase todo o dano do seu time é físico',
    'mostly-ap': 'Quase todo o dano do seu time é mágico'
  },
  enemy: {
    'no-frontline': 'Inimigos sem frontline: dá para focar o alvo mais frágil',
    'mostly-ad': 'Dano inimigo quase todo físico: armadura rende',
    'mostly-ap': 'Dano inimigo quase todo mágico: resistência mágica rende'
  }
}

function CompSummary({ side, players }: { side: 'ally' | 'enemy'; players: DraftPlayer[] }) {
  const champById = useApp((s) => s.champById)
  const comp = useMemo(
    () =>
      analyzeComp(
        players.flatMap((p) => {
          const c = p.championId > 0 ? champById.get(p.championId) : undefined
          return c ? [c] : []
        })
      ),
    [players, champById]
  )
  if (!comp) return null
  const ad = Math.round(comp.ad * 100)
  return (
    <section aria-label={side === 'ally' ? 'Composição do seu time' : 'Composição do time inimigo'} className="border border-line bg-panel/60 px-3 py-2">
      <div className="flex items-center justify-between text-xs text-mist">
        <span>Composição</span>
        <span>
          Frontline <span className="num text-sm text-snow">{comp.frontline}</span>
        </span>
      </div>
      <div className="mt-1.5 flex h-2 overflow-hidden bg-line" role="img" aria-label={`Dano: ${ad}% físico, ${100 - ad}% mágico`}>
        <span className="bg-gold" style={{ width: `${ad}%` }} />
        <span className="bg-ally" style={{ width: `${100 - ad}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px]">
        <span className="text-gold">Físico {ad}%</span>
        <span className="text-ally">Mágico {100 - ad}%</span>
      </div>
      {comp.warnings.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-snow">
          {comp.warnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <span className="text-gold" aria-hidden="true">
                !
              </span>
              {WARNING_TEXT[side][w]}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function TeamColumn({ side, players, localCellId }: Props) {
  const slots = Array.from({ length: 5 }, (_, i) => players[i])
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2" aria-label={side === 'ally' ? 'Time aliado' : 'Time inimigo'}>
        {slots.map((p, i) => (
          <Row key={p?.cellId ?? `empty-${i}`} side={side} player={p} isLocal={side === 'ally' && p?.cellId === localCellId} index={i} />
        ))}
      </ul>
      <CompSummary side={side} players={players} />
    </div>
  )
}
