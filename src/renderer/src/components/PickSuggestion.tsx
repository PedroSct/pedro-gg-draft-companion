import { useState } from 'react'
import type { DraftPlayer, Role } from '../../../shared/types'
import { ROLES, type CompReason, type Confidence, type PickScore, type PickRisk, type RecommendMode } from '../../../shared/dataTypes'
import type { ExclusionReason } from '../../../shared/dataTypes'
import { selectActiveProfile, selectFocusPlayer, selectFocusProfile, useApp } from '../store/useApp'
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
            className={`border px-3 py-1 text-sm first:rounded-l-lg last:rounded-r-lg ${
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
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${t.cls}`} data-testid="risk">
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

/** "850 jogos" / "12,4 mil jogos": mostra de quantas partidas vem o número (poucas = menos confiável). */
function gamesLabel(n: number): string {
  return n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil jogos` : `${n} jogos`
}

function VsNames({ pick }: { pick: PickScore }) {
  const first = pick.matchups[0]
  const name = useChampionName(first?.vsChampionId ?? 0)
  if (!first) return null
  const more = pick.matchups.length - 1
  return <>{`contra ${name}${more > 0 ? ` e +${more}` : ` · ${gamesLabel(first.games)}`}`}</>
}

function Verdict({ pick, owner }: { pick: PickScore; owner: string | null }) {
  const name = useChampionName(pick.championId)
  const hasMatchup = pick.matchupWinrate !== null
  const mainStat = hasMatchup ? pick.matchupWinrate : pick.baselineWinrate
  const conf = CONFIDENCE[pick.confidence]

  return (
    <section
      key={pick.championId}
      data-testid="verdict"
      aria-label={owner ? `Melhor pick de ${owner}` : 'Melhor pick da sua Pool'}
      className="verdict-in rounded-2xl bg-gradient-to-br from-gold via-gold/40 to-gold/10 p-px shadow-card"
    >
     <div className="overflow-hidden rounded-[15px] bg-deck">
      <div className="flex items-center gap-4 bg-deck p-4">
        <ChampionIcon id={pick.championId} size={88} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gold">{owner ? `Melhor pick de ${owner}` : 'Melhor pick da sua Pool'}</p>
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
        className="grid grid-cols-3 gap-px bg-line/60 text-center sm:grid-cols-6"
        title="Quanto cada fator somou ao score, em pontos"
      >
        {(
          [
            ['Matchup', pick.factors.matchup],
            ['Rota', pick.factors.baseline],
            ['Sinergia', pick.factors.synergy],
            ['Vs time inimigo', pick.factors.versus],
            ['Composição', pick.factors.comp],
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
      {(pick.compReasons.length > 0 || pick.versusList.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 bg-deck px-4 pb-2.5" aria-label="Encaixe no time">
          {pick.compReasons.map((r) => (
            <span
              key={r}
              className={`rounded-full px-2.5 py-0.5 text-xs ${COMP_GOOD.has(r) ? 'bg-ally/15 text-ally' : 'bg-enemy/15 text-enemy'}`}
            >
              {COMP_TEXT[r]}
            </span>
          ))}
          {pick.versusList.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Desempenho contra o time inimigo">
              <span className="text-xs text-mist">Vs time</span>
              {pick.versusList.slice(0, 3).map((m) => (
                <ChampChip
                  key={m.withChampionId}
                  id={m.withChampionId}
                  text={signed(m.delta)}
                  tone={m.delta >= 0.5 ? 'good' : m.delta <= -0.5 ? 'bad' : 'neutral'}
                  title={`${signed(m.delta)} pontos de vitória contra ele em qualquer rota (${m.games} partidas)`}
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
     </div>
    </section>
  )
}

const COMP_TEXT: Record<CompReason, string> = {
  'adds-magic': 'Traz dano mágico que o time não tem',
  'adds-physical': 'Traz dano físico que o time não tem',
  'too-much-physical': 'Time já tem muito dano físico',
  'too-much-magic': 'Time já tem muito dano mágico',
  'adds-frontline': 'Dá frontline ao time',
  'frontline-surplus': 'O time já tem tanque suficiente',
  'adds-cc': 'Traz controle de grupo'
}
const COMP_GOOD = new Set<CompReason>(['adds-magic', 'adds-physical', 'adds-frontline', 'adds-cc'])

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
              `${pct(pick.baselineWinrate)} na rota${pick.baselineGames ? ` · ${gamesLabel(pick.baselineGames)}` : ''}`
            ) : (
              'sem dados de meta'
            )}
          </span>
        </span>
        {(pick.risk.level === 'high' || pick.risk.level === 'medium') && (
          <span
            className={`rounded-md border px-1.5 text-xs ${pick.risk.level === 'high' ? 'border-enemy/60 text-enemy' : 'border-gold/50 text-gold'}`}
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

/** "Sugestões para: Você · Amigo (Mid) · …" — só amigos reconhecidos na seleção aparecem. */
function FocusStrip({ onlyWithFriends = false }: { onlyWithFriends?: boolean } = {}) {
  const draft = useApp((s) => s.draft)
  const profiles = useApp((s) => s.profiles)
  const owner = useApp(selectActiveProfile)
  const focus = useApp(selectFocusPlayer)
  const setFocus = useApp((s) => s.setFocus)
  const account = useApp((s) => s.identity?.account)
  if (!draft) return null
  const friends = draft.allies.filter((a) => a.profileId && a.cellId !== draft.localPlayerCellId && !a.isMe)
  const me = draft.allies.find((a) => a.cellId === draft.localPlayerCellId)
  const myProfile = profiles.find((p) => p.id === me?.profileId) ?? owner
  if (onlyWithFriends && friends.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Para quem são as sugestões">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-mist">Sugestões para</span>
        <button
          type="button"
          aria-pressed={focus?.cellId === draft.localPlayerCellId}
          onClick={() => setFocus(null)}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            focus?.cellId === draft.localPlayerCellId ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line bg-panel text-mist hover:text-snow'
          }`}
        >
          Você{myProfile ? ` · ${myProfile.nickname}` : ''}
        </button>
        {friends.map((f) => {
          const prof = profiles.find((p) => p.id === f.profileId)
          const on = focus?.cellId === f.cellId
          return (
            <button
              key={f.cellId}
              type="button"
              aria-pressed={on}
              onClick={() => setFocus(f.cellId)}
              className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-3 text-sm transition-colors ${
                on ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line bg-panel text-mist hover:text-snow'
              }`}
            >
              {f.championId > 0 ? <ChampionIcon id={f.championId} size={24} /> : <span className="h-6 w-6 rounded-full bg-raised" aria-hidden="true" />}
              {prof?.nickname}
              {f.role ? <span className="text-xs opacity-70">{ROLE_SHORT[f.role]}</span> : null}
            </button>
          )
        })}
      </div>
      {friends.length === 0 && account && profiles.length > 0 && (
        <p className="text-xs text-dim">
          Quando um amigo com perfil (e Riot ID salvo) entrar no seu time, ele aparece aqui com as próprias sugestões.
        </p>
      )}
    </div>
  )
}

function LockedPick({ player, isLocal, nickname }: { player: DraftPlayer; isLocal: boolean; nickname: string | null }) {
  const name = useChampionName(player.championId)
  return (
    <div className="flex flex-col gap-2">
      <FocusStrip onlyWithFriends />
      <section aria-label="Pick travado" className="flex items-center gap-3 rounded-2xl border border-gold/40 bg-gold/5 px-4 py-3">
        <ChampionIcon id={player.championId} size={44} />
        <div className="min-w-0">
          <div className="text-xs text-mist">{isLocal ? 'Você travou' : `${nickname ?? 'Seu amigo'} travou`}</div>
          <div className="truncate font-display text-xl font-semibold leading-tight text-snow">{name}</div>
        </div>
        <p className="ml-auto max-w-[16rem] text-right text-xs text-mist">As sugestões voltam se o pick for desfeito. A build está logo abaixo.</p>
      </section>
    </div>
  )
}

export function PickSuggestion() {
  const draft = useApp((s) => s.draft)
  const rec = useApp((s) => s.recommendation)
  const owner = useApp(selectActiveProfile)
  const profile = useApp(selectFocusProfile)
  const focus = useApp(selectFocusPlayer)
  const preview = useApp((s) => s.previewChampionId)
  const localRoleOverride = useApp((s) => s.roleOverride)
  const friendRoles = useApp((s) => s.friendRoles)
  const setPreview = useApp((s) => s.setPreview)
  const setLocalRole = useApp((s) => s.setRoleOverride)
  const setFriendRole = useApp((s) => s.setFriendRole)
  const openPool = useApp((s) => s.openPool)
  const [showAll, setShowAll] = useState(false)

  const isLocal = !focus || !draft || focus.cellId === draft.localPlayerCellId
  const roleOverride = isLocal ? localRoleOverride : (friendRoles[focus.cellId] ?? null)
  const setRole = (r: Role | null): void => (isLocal ? setLocalRole(r) : setFriendRole(focus.cellId, r))
  const subjectRole = isLocal ? draft?.localRole : focus?.role

  if (!owner && !profile) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/50 p-5 text-center">
        <p className="text-snow">Crie um perfil para receber sugestões de pick.</p>
        <button type="button" className={`${btnGold} mt-3`} onClick={openPool}>
          Criar perfil
        </button>
      </div>
    )
  }

  // Pick travado: some a lista de sugestões e fica só o campeão escolhido (a build aparece logo abaixo).
  if (draft && focus && focus.status === 'locked' && focus.championId > 0) {
    return <LockedPick player={focus} isLocal={isLocal} nickname={profile?.nickname ?? null} />
  }

  const needsRole = draft !== null && (subjectRole ?? null) === null
  const ranking = rec?.ranking ?? []
  const alternatives = ranking.slice(1)
  const visibleAlts = showAll ? alternatives : alternatives.slice(0, 3)

  return (
    <div className="flex flex-col gap-3">
      <FocusStrip />
      <ModeSwitch />
      {needsRole && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rota que você vai jogar">
          <span className="text-sm text-mist">{isLocal ? 'Sua rota' : 'Rota do amigo'}</span>
          {ROLES.map((r) => {
            const guess = !roleOverride && rec?.roleGuessed === true && rec.role === r
            return (
              <button
                key={r}
                type="button"
                aria-pressed={roleOverride === r}
                title={guess ? 'Palpite pela sua Pool e pelas rotas dos aliados. Clique para confirmar ou escolha outra.' : undefined}
                onClick={() => setRole(roleOverride === r ? null : r)}
                className={`rounded-sm border px-2.5 py-1 text-sm transition-colors ${
                  roleOverride === r
                    ? 'border-gold/70 bg-gold/10 text-gold'
                    : guess
                      ? 'border-dashed border-gold/60 text-gold'
                      : 'border-line bg-panel text-mist hover:text-snow'
                }`}
              >
                {ROLE_SHORT[r]}
                {guess && <span className="ml-1 text-xs text-mist">palpite</span>}
              </button>
            )
          })}
        </div>
      )}

      {ranking[0] ? (
        <>
          <Verdict pick={ranking[0]} owner={isLocal ? null : (profile?.nickname ?? null)} />
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
        <div className="rounded-2xl border border-dashed border-line bg-panel/50 p-5 text-center">
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
