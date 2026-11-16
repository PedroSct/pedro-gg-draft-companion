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
        <p className="font-display text-xl font-semibold leading-none text-snow">{name}</p>
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

  const tone = ban ? 'border-enemy/50 text-enemy' : 'border-gold/50 text-gold'
  return (
    <section role="region" aria-label={ban ? 'Sua vez de banir' : 'Sua vez de escolher'} className="turn-in">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={`inline-flex items-center gap-2 rounded-full border px-3 py-0.5 text-xs font-semibold ${tone}`}>
          <span aria-hidden="true" className="relative grid h-2 w-2 place-items-center">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${ban ? 'bg-enemy' : 'bg-gold'}`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${ban ? 'bg-enemy' : 'bg-gold'}`} />
          </span>
          {ban ? 'Sua vez de banir' : 'Sua vez de escolher'}
        </h2>
        {ban ? (
          <p className="text-sm text-mist">Clique em Banir no campeão que você quer tirar da partida. Você confirma antes.</p>
        ) : !(isLocal && target > 0) ? (
          <p className="text-sm text-mist">Escolha um campeão no cliente ou clique em uma sugestão da Pool para ver a build.</p>
        ) : null}
      </div>
      {!ban && isLocal && target > 0 && <PickTarget championId={target} />}
    </section>
  )
}
