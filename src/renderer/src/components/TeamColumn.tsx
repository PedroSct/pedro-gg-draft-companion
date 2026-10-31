import type { DraftPlayer, PickStatus } from '../../../shared/types'
import { selectActiveProfile, selectFocusPlayer, useApp } from '../store/useApp'
import { ROLE_SHORT, splashUrl } from '../lib/format'
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
  const info = useApp((s) => (player && player.championId > 0 ? s.champById.get(player.championId) : undefined))
  const profile = useApp((s) => (player?.profileId ? s.profiles.find((p) => p.id === player.profileId) : undefined))
  const owner = useApp(selectActiveProfile)
  const focusCell = useApp((s) => selectFocusPlayer(s)?.cellId)
  const setFocus = useApp((s) => s.setFocus)
  const topPick = useApp((s) => (player ? s.recs[player.cellId]?.ranking[0]?.championId : undefined))
  const topName = useChampionName(topPick ?? 0)
  const status = player?.status ?? 'none'
  const accent = ally ? 'border-ally' : 'border-enemy'

  const who = isLocal ? (profile?.nickname ?? owner?.nickname ?? 'Você') : (profile?.nickname ?? null)
  const friend = ally && !isLocal && !!profile
  const clickable = ally && !!player && (isLocal || friend)
  const focused = clickable && focusCell === player?.cellId
  const locked = status === 'locked'

  const body = (
    <>
      {info && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 bg-cover bg-top transition-opacity duration-500 ${locked ? 'opacity-40' : 'opacity-20'}`}
          style={{ backgroundImage: `url("${splashUrl(info.key)}")` }}
        />
      )}
      <span aria-hidden="true" className={`pointer-events-none absolute inset-y-2 w-1 rounded-full ${accent.replace('border-', 'bg-')} ${ally ? 'left-1' : 'right-1'}`} />
      <span aria-hidden="true" className={`pointer-events-none absolute inset-0 ${ally ? 'bg-gradient-to-r' : 'bg-gradient-to-l'} from-deck/95 via-deck/70 to-transparent`} />
      <span className={`relative flex w-full items-center gap-3 ${ally ? '' : 'flex-row-reverse text-right'}`}>
        {player && player.championId > 0 ? (
          <ChampionIcon id={player.championId} size={52} dim={status === 'hovering'} className={locked ? 'ring-2 ring-white/10' : ''} />
        ) : (
          <span className="chamfer-sm block h-[52px] w-[52px] shrink-0 border border-dashed border-line bg-deck" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-xl font-semibold leading-tight">
            {name || <span className="text-dim">Sem campeão</span>}
          </span>
          <span className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-mist ${ally ? '' : 'justify-end'}`}>
            {who && (
              <span className={`rounded-full px-1.5 py-px font-medium ${isLocal ? 'bg-ally/15 text-ally' : 'bg-gold/15 text-gold'}`}>
                {isLocal ? `${who} · você` : who}
              </span>
            )}
            {player?.role && <span>{ROLE_SHORT[player.role]}</span>}
            <span className={locked ? 'text-snow' : ''}>{STATUS_TEXT[status]}</span>
          </span>
          {friend && topPick !== undefined && (
            <span className="mt-0.5 block truncate text-xs text-gold">Sugestão: {topName}</span>
          )}
        </span>
      </span>
    </>
  )

  const cls = `rise relative flex min-h-[68px] items-center overflow-hidden rounded-xl border px-3.5 py-2 text-left transition-colors ${
    focused ? 'border-gold/60 bg-ally/10' : isLocal ? 'border-ally/30 bg-ally/10' : 'border-line/70 bg-panel/70'
  }`
  const style = { ['--d' as string]: `${index * 60}ms` }
  const label = `${ally ? 'Aliado' : 'Inimigo'}: ${name || 'sem campeão'}`

  return (
    <li aria-label={label} style={style} className="list-none">
      {clickable ? (
        <button
          type="button"
          onClick={() => setFocus(player!.cellId)}
          aria-pressed={focused}
          title={isLocal ? 'Ver as suas sugestões' : `Ver as sugestões de ${who}`}
          className={`${cls} w-full hover:bg-raised/70`}
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
          <Row key={p?.cellId ?? `empty-${i}`} side={side} player={p} isLocal={side === 'ally' && (p?.isMe === true || p?.cellId === localCellId)} index={i} />
        ))}
      </ul>
      <CompSummary side={side} players={players} />
    </div>
  )
}
