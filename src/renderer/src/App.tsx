import { Suspense, lazy, useEffect, useState } from 'react'
import { useApp } from './store/useApp'
import { Header } from './components/Header'
import { TeamColumn } from './components/TeamColumn'
import { BansBar } from './components/BansBar'
import { PickSuggestion } from './components/PickSuggestion'
import { BuildPanel } from './components/BuildPanel'
import { IdleScreen } from './components/IdleScreen'
import { UpdateBanner } from './components/UpdateBanner'
import { Splash } from './components/Splash'
import { btn } from './lib/ui'

// Telas pesadas só são carregadas quando abrem: o app inicia mais rápido e gasta menos memória.
const PoolEditor = lazy(() => import('./components/PoolEditor').then((m) => ({ default: m.PoolEditor })))
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })))
const PostGameScreen = lazy(() => import('./components/PostGame').then((m) => ({ default: m.PostGameScreen })))

/** "15.20.1" e "15.20" são o mesmo patch: compara só os dois primeiros números. */
const patchOf = (v: string): string | null => {
  const m = /^(\d+)\.(\d+)/.exec(v)
  return m ? `${m[1]}.${m[2]}` : null
}

function Banners() {
  const metaInfo = useApp((s) => s.metaInfo)
  const catalogError = useApp((s) => s.catalogError)
  const loadCatalog = useApp((s) => s.loadCatalog)
  const openSettings = useApp((s) => s.openSettings)
  const catalog = useApp((s) => s.catalog)
  const updateMeta = useApp((s) => s.updateMeta)
  const [refreshing, setRefreshing] = useState(false)
  const gamePatch = catalog ? patchOf(catalog.version) : null
  const metaPatch = metaInfo && !metaInfo.isSample ? patchOf(metaInfo.patch) : null
  const stale = gamePatch !== null && metaPatch !== null && gamePatch !== metaPatch

  return (
    <>
      {stale && (
        <div role="status" className="flex items-center gap-3 border-b border-gold/30 bg-gold/10 px-5 py-2 text-sm text-gold">
          <span>
            Os dados de builds e matchups são do patch {metaPatch} e o jogo está no {gamePatch}. Itens e campeões mudaram; a sugestão pode estar desatualizada.
          </span>
          <button
            type="button"
            className="underline underline-offset-4 hover:text-snow disabled:opacity-50"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true)
              void updateMeta().finally(() => setRefreshing(false))
            }}
          >
            {refreshing ? 'Atualizando…' : 'Atualizar dados'}
          </button>
        </div>
      )}
      {catalogError && (
        <div role="alert" className="flex items-center gap-3 border-b border-enemy/40 bg-enemy/10 px-5 py-2 text-sm">
          <span>{catalogError}</span>
          <button type="button" className={btn} onClick={() => void loadCatalog()}>
            Tentar de novo
          </button>
        </div>
      )}
      {metaInfo?.isSample && (
        <div className="flex items-center gap-3 border-b border-gold/30 bg-gold/10 px-5 py-2 text-sm text-gold">
          <span>As sugestões usam dados de amostra, que não refletem o meta real.</span>
          <button type="button" className="underline underline-offset-4 hover:text-snow" onClick={openSettings}>
            Importar dados reais
          </button>
        </div>
      )}
    </>
  )
}

function DraftScreen() {
  const draft = useApp((s) => s.draft)
  if (!draft) return null

  return (
    <div className="grid h-full grid-cols-[minmax(250px,1fr)_minmax(440px,1.7fr)_minmax(250px,1fr)] gap-5">
      <TeamColumn side="ally" players={draft.allies} localCellId={draft.localPlayerCellId} />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
        <BansBar allies={draft.bans.allies} enemies={draft.bans.enemies} />
        <PickSuggestion />
        <BuildPanel />
      </div>
      <TeamColumn side="enemy" players={draft.enemies} localCellId={-1} />
    </div>
  )
}

export default function App() {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  const draft = useApp((s) => s.draft)
  const settings = useApp((s) => s.settings)
  const view = useApp((s) => s.view)
  const poolOpen = useApp((s) => s.poolOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const reduceMotion = useApp((s) => s.settings?.reduceMotion ?? false)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    let off: (() => void) | undefined
    let cancelled = false
    init()
      .then((unsubscribe) => {
        if (cancelled) unsubscribe()
        else off = unsubscribe
      })
      .catch(() => setFatal('Não foi possível iniciar o app. Feche e abra de novo.'))
    return () => {
      cancelled = true
      off?.()
    }
  }, [init])

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
  }, [reduceMotion])

  if (fatal) {
    return (
      <div role="alert" className="grid h-full place-items-center text-enemy">
        {fatal}
      </div>
    )
  }

  return (
    <div className="bg-aurora relative flex h-full flex-col">
      <div className="bg-grid pointer-events-none absolute inset-0 z-0" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col">
        <Header />
        <UpdateBanner />
        <Banners />
        <main className="min-h-0 flex-1 p-5">
          <Suspense fallback={null}>{!ready ? null : view === 'postgame' ? <PostGameScreen /> : draft ? <DraftScreen /> : <IdleScreen />}</Suspense>
        </main>
        <Suspense fallback={null}>
          {poolOpen && <PoolEditor />}
          {settingsOpen && <SettingsDialog />}
        </Suspense>
      {import.meta.env.MODE !== 'test' && settings?.introAnimation !== false && !reduceMotion && <Splash ready={ready} />}
      </div>
    </div>
  )
}
