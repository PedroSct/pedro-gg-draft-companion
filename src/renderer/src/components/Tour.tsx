import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from '../store/useApp'
import { btn, btnGold } from '../lib/ui'

interface Step {
  /** valor de data-tour do elemento a destacar; sem ele o passo fica no centro */
  target?: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    title: 'Bem-vindo ao Pedro.gg',
    body: 'Este app acompanha a seleção de campeões do League of Legends e sugere o melhor pick para você e para os seus amigos. Ele conversa com o cliente do jogo sozinho (só lê o que acontece) e precisa que o LoL esteja aberto.'
  },
  {
    target: 'nav-pools',
    title: '1. Monte as Pools',
    body: 'Em Pools você cria o seu perfil e o dos amigos: escolha os campeões de cada rota e dê estrelas de conforto. É a base de todas as sugestões. Com o Riot ID salvo, o app reconhece cada um sozinho na seleção.'
  },
  {
    target: 'nav-draft',
    title: '2. Antes da partida',
    body: 'Com o cliente aberto e fora de uma seleção, a aba Draft pergunta 2 ou 3 campeões que você não gosta de enfrentar e quais você mais bane. Isso entra nas sugestões de banimento. Também mostra o seu último plano de jogo.'
  },
  {
    target: 'nav-draft',
    title: '3. Draft em 3 etapas',
    body: 'A seleção aparece em ordem. Bans: o que banir e por quê, o seu confronto de rota com pontos fortes e fracos e, se você joga de suporte ou atirador, o combo da dupla. Picks: o melhor pick da sua Pool e os counters, quando os bans acabam. Build: runas, itens e plano de jogo, só depois de travar o campeão. Dá para espiar outra etapa pelas abas no topo. Runas, feitiços e itens vão ao cliente com um clique.'
  },
  {
    target: 'nav-meta',
    title: '4. Meta: ranking, Tier List e builds',
    body: 'Veja o tier de cada campeão por rota em duas visões: Lista (ordene por vitórias, presença ou jogos) e Tier List (faixas S a D com os campeões). Clique em um campeão para ver confrontos, sinergias e a build mais usada. Escolha o servidor (Global, BR, NA, EUW, KR e outros) para ver os dados daquela região.'
  },
  {
    target: 'nav-postgame',
    title: '5. Pós-jogo e Evolução',
    body: 'Quando a partida termina, o app analisa como você foi e mostra o que melhorar. Na aba Evolução fica a pontuação geral por área (farm, rota, lutas, visão, objetivos e sobrevivência) sobre as suas últimas partidas, com a tendência e as áreas para focar.'
  },
  {
    target: 'nav-coach',
    title: '6. Treino',
    body: 'Lê as suas partidas recentes e mostra o seu jeito de jogar, avisa se a Pool está concentrada demais e sugere campeões para experimentar, com plano de jogo e entrada na Pool com um clique.'
  },
  {
    title: 'Durante a partida',
    body: 'Um painel (overlay) mostra a build e a habilidade a subir, e diz o que comprar agora conforme o seu ouro. Ctrl+Shift+F9 muda o tamanho e Ctrl+Shift+F10 deixa mover. O app só mostra informação: nunca joga por você.'
  },
  {
    target: 'autoaccept',
    title: 'Aceitar partida sozinho',
    body: 'Se quiser, deixe o app clicar em Aceitar quando a partida for encontrada. Está em manual por padrão: é só ligar aqui.'
  },
  {
    target: 'settings',
    title: 'Configurações',
    body: 'Aqui ficam a região padrão dos dados, os atalhos do overlay, as atualizações e, se precisar, o botão para ver este tutorial de novo. Pronto: comece criando o seu perfil.'
  }
]

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const PAD = 6
const CARD_W = 360

function findTarget(target?: string): Rect | null {
  if (!target) return null
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/** Tutorial de primeira vez: passo a passo com destaque nos botões do cabeçalho. */
export function Tour() {
  const finish = useApp((s) => s.finishTour)
  const setView = useApp((s) => s.setView)
  const profiles = useApp((s) => s.profiles)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = STEPS[index]
  const last = index === STEPS.length - 1

  useLayoutEffect(() => {
    const update = (): void => setRect(findTarget(step.target))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [step])

  useEffect(() => {
    nextRef.current?.focus()
  }, [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void finish()
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, STEPS.length - 1))
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish])

  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  const cardLeft = rect ? Math.max(12, Math.min(rect.left + rect.width / 2 - CARD_W / 2, vw - CARD_W - 12)) : Math.max(12, vw / 2 - CARD_W / 2)
  const cardTop = rect ? rect.top + rect.height + PAD + 12 : Math.max(24, vh / 2 - 130)

  async function done(goToPools: boolean): Promise<void> {
    await finish()
    if (goToPools) setView('pools')
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Tutorial">
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-gold"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: '0 0 0 9999px rgb(5 7 12 / 0.78)' }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-night/80" />
      )}
      <div
        className="absolute rounded-2xl border border-gold/40 bg-deck p-5 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.9)]"
        style={{ top: cardTop, left: cardLeft, width: CARD_W, maxWidth: 'calc(100vw - 24px)' }}
      >
        <p className="text-xs text-mist">
          Passo {index + 1} de {STEPS.length}
        </p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-snow">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-mist">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex gap-1" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-gold' : 'bg-line'}`} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!last && (
              <button type="button" className="text-sm text-dim hover:text-snow" onClick={() => void done(false)}>
                Pular
              </button>
            )}
            {index > 0 && (
              <button type="button" className={btn} onClick={() => setIndex(index - 1)}>
                Voltar
              </button>
            )}
            {last ? (
              <>
                <button type="button" className={btn} onClick={() => void done(false)}>
                  Fechar
                </button>
                {profiles.length === 0 && (
                  <button ref={nextRef} type="button" className={btnGold} onClick={() => void done(true)}>
                    Criar meu perfil
                  </button>
                )}
              </>
            ) : (
              <button ref={nextRef} type="button" className={btnGold} onClick={() => setIndex(index + 1)}>
                Próximo
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
