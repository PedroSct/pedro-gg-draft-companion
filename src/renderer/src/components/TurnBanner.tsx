import { selectFocusPlayer, useApp } from '../store/useApp'
import { ChampionIcon, useChampionName } from './Icons'
import { DraftActButton } from './DraftActButton'

function PickTarget({ championId }: { championId: number }) {
  const name = useChampionName(championId)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <ChampionIcon id={championId} size={48} />
      <div className="min-w-0">
        <p className="text-xs text-mist">Campeão em foco</p>
        <p className="font-display text-2xl font-semibold leading-none text-snow">{name}</p>
      </div>
      <div className="ml-auto">
        <DraftActButton championId={championId} type="pick" compact />
      </div>
    </div>
  )
}

/**
 * Aviso grande e animado na sua vez de banir ou escolher. Não age sozinho: mostra o campeão em foco e os botões
 * (que pedem confirmação). Some assim que a vez passa.
 */
export function TurnBanner() {
  const turn = useApp((s) => s.draft?.turn ?? null)
  const draft = useApp((s) => s.draft)
  const rec = useApp((s) => s.recommendation)
  const preview = useApp((s) => s.previewChampionId)
  const player = useApp(selectFocusPlayer)
  if (!draft || !turn) return null

  const ban = turn.type === 'ban'
  const isLocal = !player || player.cellId === draft.localPlayerCellId
  const ranking = rec?.ranking ?? []
  const target = preview !== null && ranking.some((r) => r.championId === preview) ? preview : (ranking[0]?.championId ?? 0)

  return (
    <section
      role="region"
      aria-label={ban ? 'Sua vez de banir' : 'Sua vez de escolher'}
      className="turn-banner rounded-2xl border p-4"
      style={{
        ['--turn-color' as string]: ban ? 'var(--color-enemy)' : 'var(--color-gold)',
        borderColor: ban ? 'color-mix(in srgb, var(--color-enemy) 60%, transparent)' : 'color-mix(in srgb, var(--color-gold) 60%, transparent)',
        background: ban
          ? 'linear-gradient(135deg, color-mix(in srgb, var(--color-enemy) 14%, var(--color-deck)), var(--color-deck))'
          : 'linear-gradient(135deg, color-mix(in srgb, var(--color-gold) 14%, var(--color-deck)), var(--color-deck))'
      }}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className={`relative grid h-3 w-3 place-items-center`}>
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${ban ? 'bg-enemy' : 'bg-gold'}`} />
          <span className={`relative inline-flex h-3 w-3 rounded-full ${ban ? 'bg-enemy' : 'bg-gold'}`} />
        </span>
        <h2 className={`font-display text-3xl font-semibold leading-none ${ban ? 'text-enemy' : 'text-gold'}`}>{ban ? 'Sua vez de banir' : 'Sua vez de escolher'}</h2>
      </div>
      {ban ? (
        <p className="mt-1.5 text-sm text-mist">Veja as sugestões logo abaixo e clique em Banir no campeão que você quer tirar da partida. Você confirma antes de banir.</p>
      ) : isLocal && target > 0 ? (
        <PickTarget championId={target} />
      ) : (
        <p className="mt-1.5 text-sm text-mist">Escolha um campeão no cliente ou clique em uma sugestão da Pool para ver a build.</p>
      )}
    </section>
  )
}
