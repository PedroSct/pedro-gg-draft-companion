import type { DraftPlayer, PickStatus } from '../../../shared/types'
import { selectActiveProfile, selectFocusPlayer, useApp } from '../store/useApp'
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

function Row({ side, player, isLocal }: { side: 'ally' | 'enemy'; player: DraftPlayer | undefined; isLocal: boolean }) {
  const ally = side === 'ally'
  const name = useChampionName(player?.championId ?? 0)
  const profile = useApp((s) => (player?.profileId ? s.profiles.find((p) => p.id === player.profileId) : undefined))
  const owner = useApp(selectActiveProfile)
  const focusCell = useApp((s) => selectFocusPlayer(s)?.cellId)
  const setFocus = useApp((s) => s.setFocus)
  const topPick = useApp((s) => (player ? s.recs[player.cellId]?.ranking[0]?.championId : undefined))
  const topName = useChampionName(topPick ?? 0)
  const status = player?.status ?? 'none'

  const who = isLocal ? (profile?.nickname ?? owner?.nickname ?? 'Você') : (profile?.nickname ?? null)
  const friend = ally && !isLocal && !!profile
  const clickable = ally && !!player && (isLocal || friend)
  const focused = clickable && focusCell === player?.cellId
  const locked = status === 'locked'

  const ring = isLocal ? 'ring-2 ring-gold' : locked ? (ally ? 'ring-2 ring-ally' : 'ring-2 ring-enemy') : ''
  const body = (
    <span className={`flex w-full items-center gap-3 ${ally ? '' : 'flex-row-reverse text-right'}`}>
      <span className={`w-8 shrink-0 text-[11px] font-medium uppercase tracking-wider ${isLocal ? 'text-gold' : 'text-dim'} ${ally ? '' : 'text-right'}`}>
        {player?.role ? ROLE_SHORT[player.role] : ''}
      </span>
      {player && player.championId > 0 ? (
        <ChampionIcon id={player.championId} size={40} dim={status === 'hovering'} className={ring} />
      ) : (
        <span className="block h-10 w-10 shrink-0 rounded-md border border-dashed border-line" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium leading-tight">{name || <span className="text-dim">Aguardando</span>}</span>
        <span className={`flex flex-wrap items-center gap-x-2 text-xs text-dim ${ally ? '' : 'justify-end'}`}>
          {who && <span className={isLocal ? 'text-gold' : 'text-mist'}>{isLocal ? `${who} · você` : who}</span>}
          {name && <span className={locked ? 'text-mist' : ''}>{STATUS_TEXT[status]}</span>}
        </span>
        {friend && topPick !== undefined && <span className="block truncate text-xs text-gold">Sugestão: {topName}</span>}
      </span>
    </span>
  )

  const cls = `block w-full rounded-md px-1 py-2.5 text-left transition-colors ${focused ? 'bg-raised' : ''}`
  const label = `${ally ? 'Aliado' : 'Inimigo'}: ${name || 'sem campeão'}`

  return (
    <li aria-label={label} className="list-none border-b border-line">
      {clickable ? (
        <button
          type="button"
          onClick={() => setFocus(player!.cellId)}
          aria-pressed={focused}
          title={isLocal ? 'Ver as suas sugestões' : `Ver as sugestões de ${who}`}
          className={`${cls} hover:bg-raised/60`}
        >
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
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
    <section aria-label={side === 'ally' ? 'Composição do seu time' : 'Composição do time inimigo'} className="py-1">
      <div className="flex items-center justify-between text-xs text-mist">
        <span>Composição</span>
        <span>
          Frontline <span className="num text-sm text-snow">{comp.frontline}</span>
        </span>
      </div>
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`Dano: ${ad}% físico, ${100 - ad}% mágico`}>
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
    <div className="flex flex-col gap-4">
      <div>
        <h2 className={`border-b border-line pb-2.5 text-xs font-semibold uppercase tracking-wider text-dim ${side === 'enemy' ? 'text-right' : ''}`}>
          {side === 'ally' ? 'Seu time' : 'Time inimigo'}
        </h2>
        <ul aria-label={side === 'ally' ? 'Time aliado' : 'Time inimigo'}>
          {slots.map((p, i) => (
            <Row key={p?.cellId ?? `empty-${i}`} side={side} player={p} isLocal={side === 'ally' && (p?.isMe === true || p?.cellId === localCellId)} />
          ))}
        </ul>
      </div>
      <CompSummary side={side} players={players} />
    </div>
  )
}
