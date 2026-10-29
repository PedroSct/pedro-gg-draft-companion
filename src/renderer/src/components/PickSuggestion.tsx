import { useState } from 'react'
import { ROLES, type Confidence, type PickScore, type PickRisk, type RecommendMode } from '../../../shared/dataTypes'
import type { ExclusionReason } from '../../../shared/dataTypes'
import { selectActiveProfile, useApp } from '../store/useApp'
import { pct, ROLE_LABEL, ROLE_SHORT, signed } from '../lib/format'
import { btnGold } from '../lib/ui'
import { ChampionIcon, Stars, useChampionName } from './Icons'

const CONFIDENCE: Record<Confidence, { label: string; bars: number }> = {
  high: { label: 'Confiança alta', bars: 3 },
  medium: { label: 'Confiança média', bars: 2 },
  low: { label: 'Confiança baixa', bars: 1 }
}

const EXCLUSION: Record<ExclusionReason, string> = {
  banned: 'Banido',
  'picked-ally': 'Já escolhido por um aliado',
  'picked-enemy': 'Já escolhido por um inimigo'
}

const MODES: { id: RecommendMode; label: string; hint: string }[] = [
  { id: 'balanced', label: 'Equilibrado', hint: 'Mistura meta, matchup, sinergia e o seu conforto' },
  { id: 'comfort', label: 'Conforto', hint: 'Prioriza os campeões que você domina' },
  { id: 'meta', label: 'Meta', hint: 'Prioriza os números do patch e ignora quase todo o conforto' }
]

function ModeSwitch() {
  const mode = useApp((s) => s.settings?.pickMode ?? 'balanced')
  const setMode = useApp((s) => s.setPickMode)
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Prioridade da sugestão">
      <span className="text-sm text-mist">Prioridade</span>
      <div className="flex">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.hint}
            aria-pressed={mode === m.id}
            onClick={() => void setMode(m.id)}
            className={`border px-3 py-1 text-sm first:rounded-l-sm last:rounded-r-sm ${
              mode === m.id ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line bg-panel text-mist hover:text-snow'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Campeão com um número ao lado (winrate contra ele, ou ganho de sinergia). */
function ChampChip({ id, text, tone, title, showName = false }: { id: number; text: string; tone: 'good' | 'bad' | 'neutral'; title: string; showName?: boolean }) {
  const name = useChampionName(id)
  const color = tone === 'good' ? 'text-ally' : tone === 'bad' ? 'text-enemy' : 'text-mist'
  return (
    <span className="flex items-center gap-1.5 border border-line bg-panel/80 py-0.5 pl-0.5 pr-2" title={title}>
      <ChampionIcon id={id} size={24} />
      <span className={showName ? 'text-sm text-snow' : 'sr-only'}>{name}</span>
      <span className={`num text-sm ${color}`}>{text}</span>
    </span>
  )
}

const RISK_TEXT: Record<Exclude<PickRisk['level'], 'none'>, { label: string; cls: string }> = {
  low: { label: 'Risco de counter baixo', cls: 'border-line text-mist' },
  medium: { label: 'Risco de counter médio', cls: 'border-gold/50 bg-gold/10 text-gold' },
  high: { label: 'Risco de counter alto', cls: 'border-enemy/60 bg-enemy/10 text-enemy' }
}

/** Estilo Draftforge: quem ainda pode ser escolhido pelo inimigo e vence o seu pick. */
function RiskBadge({ risk }: { risk: PickRisk }) {
  if (risk.level === 'none') return null
  const t = RISK_TEXT[risk.level]
  return (
    <div className={`flex flex-wrap items-center gap-2 border px-3 py-1.5 text-sm ${t.cls}`} data-testid="risk">
      <span className="font-medium">{t.label}</span>
      <span className="text-xs opacity-80">ainda disponíveis para o inimigo:</span>
      {risk.counters.map((c) => (
        <ChampChip
          key={c.vsChampionId}
          id={c.vsChampionId}
          text={pct(c.winrate)}
          tone="bad"
          showName
          title={`Seu campeão tem ${pct(c.winrate)} de vitória contra ele (${c.games} partidas)`}
        />
      ))}
    </div>
  )
}

function Meter({ bars }: { bars: number }) {
  return (
    <span className="flex items-end gap-0.5" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`w-1 ${n <= bars ? 'bg-gold' : 'bg-line'}`} style={{ height: 4 + n * 3 }} />
      ))}
    </span>
  )
}

function VsNames({ pick }: { pick: PickScore }) {
  const first = pick.matchups[0]
  const name = useChampionName(first?.vsChampionId ?? 0)
  if (!first) return null
  const more = pick.matchups.length - 1
  return <>{`contra ${name}${more > 0 ? ` e +${more}` : ''}`}</>
}

function Verdict({ pick }: { pick: PickScore }) {
  const name = useChampionName(pick.championId)
  const hasMatchup = pick.matchupWinrate !== null
  const mainStat = hasMatchup ? pick.matchupWinrate : pick.baselineWinrate
  const conf = CONFIDENCE[pick.confidence]

  return (
    <section
      key={pick.championId}
      data-testid="verdict"
      aria-label="Melhor pick da sua Pool"
      className="verdict-in chamfer bg-gradient-to-br from-gold via-gold/40 to-gold/10 p-px"
    >
      <div className="chamfer flex items-center gap-4 bg-deck p-4">
        <ChampionIcon id={pick.championId} size={88} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gold">Melhor pick da sua Pool</p>
          <h2 className="truncate font-display text-4xl font-bold leading-none">{name}</h2>
          <p className="mt-1.5 flex items-center gap-3 text-sm text-mist">
            <span>{ROLE_LABEL[pick.role]}</span>
            <span className="flex items-center gap-1.5">
              <Meter bars={conf.bars} />
              {conf.label}
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-5xl font-semibold leading-none text-snow">
            {mainStat === null ? '—' : pct(mainStat)}
          </div>
          <div className="mt-1 text-sm text-mist">
            {hasMatchup ? <VsNames pick={pick} /> : mainStat === null ? 'sem dados de meta' : 'winrate na rota'}
          </div>
        </div>
      </div>
      <dl
        className="chamfer grid grid-cols-4 gap-px bg-line/60 text-center"
        title="Quanto cada fator somou ao score, em pontos"
      >
        {(
          [
            ['Matchup', pick.factors.matchup],
            ['Rota', pick.factors.baseline],
            ['Sinergia', pick.factors.synergy],
            ['Conforto', pick.factors.comfort]
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="bg-deck py-1.5">
            <dt className="text-xs text-mist">{label}</dt>
            <dd className={`num text-lg ${value > 0 ? 'text-ally' : value < 0 ? 'text-enemy' : 'text-mist'}`}>
              {signed(value)}
            </dd>
          </div>
        ))}
      </dl>
      {(pick.matchups.length > 0 || pick.synergies.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-deck px-4 py-2.5">
          {pick.matchups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Confrontos diretos">
              <span className="text-xs text-mist">Contra</span>
              {pick.matchups.map((m) => (
                <ChampChip
                  key={m.vsChampionId}
                  id={m.vsChampionId}
                  text={pct(m.winrate)}
                  tone={m.winrate >= 0.51 ? 'good' : m.winrate <= 0.49 ? 'bad' : 'neutral'}
                  title={`${pct(m.winrate)} de vitória (${m.games} partidas)`}
                />
              ))}
            </div>
          )}
          {pick.synergies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Sinergia com aliados">
              <span className="text-xs text-mist">Com</span>
              {pick.synergies.slice(0, 3).map((m) => (
                <ChampChip
                  key={m.withChampionId}
                  id={m.withChampionId}
                  text={signed(m.delta)}
                  tone={m.delta >= 0.5 ? 'good' : m.delta <= -0.5 ? 'bad' : 'neutral'}
                  title={`${signed(m.delta)} pontos de vitória quando joga com ele (${m.games} partidas)`}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {pick.risk.level !== 'none' && (
        <div className="bg-deck px-4 pb-3">
          <RiskBadge risk={pick.risk} />
        </div>
      )}
    </section>
  )
}

function AltRow({ pick, selected, onSelect }: { pick: PickScore; selected: boolean; onSelect: () => void }) {
  const name = useChampionName(pick.championId)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full items-center gap-3 border px-2.5 py-1.5 text-left transition-colors hover:bg-raised ${
          selected ? 'border-gold/70 bg-raised' : 'border-line bg-panel/70'
        }`}
      >
        <ChampionIcon id={pick.championId} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg font-semibold leading-tight">{name}</span>
          <span className="block truncate text-xs text-mist">
            {pick.matchupWinrate !== null ? (
              <>
                {pct(pick.matchupWinrate)} <VsNames pick={pick} />
              </>
            ) : pick.baselineWinrate !== null ? (
              `${pct(pick.baselineWinrate)} na rota`
            ) : (
              'sem dados de meta'
            )}
          </span>
        </span>
        {(pick.risk.level === 'high' || pick.risk.level === 'medium') && (
          <span
            className={`border px-1.5 text-xs ${pick.risk.level === 'high' ? 'border-enemy/60 text-enemy' : 'border-gold/50 text-gold'}`}
            title={RISK_TEXT[pick.risk.level].label}
          >
            RISCO
          </span>
        )}
        <Stars value={pick.comfort} label={`Conforto com ${name}`} />
        <span
          className={`num w-12 text-right text-xl ${pick.score > 0 ? 'text-ally' : pick.score < 0 ? 'text-enemy' : 'text-mist'}`}
        >
          {signed(pick.score)}
        </span>
      </button>
    </li>
  )
}

function Unavailable({ items }: { items: { championId: number; reason: ExclusionReason }[] }) {
  if (!items.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-mist">
      <span>Indisponíveis</span>
      {items.map((x) => (
        <span key={x.championId} title={EXCLUSION[x.reason]}>
          <ChampionIcon id={x.championId} size={26} dim />
        </span>
      ))}
    </div>
  )
}

export function PickSuggestion() {
  const draft = useApp((s) => s.draft)
  const rec = useApp((s) => s.recommendation)
  const profile = useApp(selectActiveProfile)
  const preview = useApp((s) => s.previewChampionId)
  const roleOverride = useApp((s) => s.roleOverride)
  const setPreview = useApp((s) => s.setPreview)
  const setRole = useApp((s) => s.setRoleOverride)
  const openPool = useApp((s) => s.openPool)
  const [showAll, setShowAll] = useState(false)

  if (!profile) {
    return (
      <div className="border border-dashed border-line bg-panel/50 p-5 text-center">
        <p className="text-snow">Crie um perfil para receber sugestões de pick.</p>
        <button type="button" className={`${btnGold} mt-3`} onClick={openPool}>
          Criar perfil
        </button>
      </div>
    )
  }

  const needsRole = draft !== null && draft.localRole === null
  const ranking = rec?.ranking ?? []
  const alternatives = ranking.slice(1)
  const visibleAlts = showAll ? alternatives : alternatives.slice(0, 3)

  return (
    <div className="flex flex-col gap-3">
      <ModeSwitch />
      {needsRole && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rota que você vai jogar">
          <span className="text-sm text-mist">Sua rota</span>
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={roleOverride === r}
              onClick={() => setRole(roleOverride === r ? null : r)}
              className={`rounded-sm border px-2.5 py-1 text-sm transition-colors ${
                roleOverride === r ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line bg-panel text-mist hover:text-snow'
              }`}
            >
              {ROLE_SHORT[r]}
            </button>
          ))}
        </div>
      )}

      {ranking[0] ? (
        <>
          <Verdict pick={ranking[0]} />
          {visibleAlts.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="Outras opções da Pool">
              {visibleAlts.map((p) => (
                <AltRow
                  key={`${p.championId}-${p.role}`}
                  pick={p}
                  selected={preview === p.championId}
                  onSelect={() => setPreview(preview === p.championId ? null : p.championId)}
                />
              ))}
            </ul>
          )}
          {alternatives.length > 3 && (
            <button type="button" className="self-start text-sm text-mist underline-offset-4 hover:text-snow hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Mostrar menos' : `Mostrar todas as opções (${alternatives.length})`}
            </button>
          )}
        </>
      ) : (
        <div className="border border-dashed border-line bg-panel/50 p-5 text-center">
          {rec?.note === 'empty-pool' ? (
            <>
              <p>
                {rec.role ? `Sua Pool de ${ROLE_LABEL[rec.role]} está vazia.` : 'Sua Pool está vazia.'} Adicione campeões para ver sugestões.
              </p>
              <button type="button" className={`${btnGold} mt-3`} onClick={openPool}>
                Editar Pool
              </button>
            </>
          ) : rec?.note === 'all-unavailable' ? (
            <p>Todos os campeões da sua Pool nessa rota estão banidos ou já foram escolhidos.</p>
          ) : needsRole && roleOverride === null ? (
            <p>Escolha a rota que você vai jogar para ver as sugestões.</p>
          ) : (
            <p className="text-mist">Calculando sugestões…</p>
          )}
        </div>
      )}

      <Unavailable items={rec?.excluded ?? []} />
    </div>
  )
}
