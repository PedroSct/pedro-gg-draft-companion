// src/main/lcu/draftAct.ts
// Escolher ou banir pelo app. Só roda quando a pessoa clica (uma ação por clique), só na vez dela e só no campeão que
// ela apontou. Nada aqui é automático: não há temporizador, nem escolha por conta própria. O main confere de novo no
// cliente se a vez é mesmo dela e se o campeão está disponível antes de escrever.
import { findTurn } from './champSelect'

export type ActKind = 'hover' | 'lock'
export type ActType = 'pick' | 'ban'

export interface ActRequest {
  kind: ActKind
  type: ActType
  championId: number
}

export interface ActResult {
  ok: boolean
  message: string
}

export interface ActIO {
  get(path: string): Promise<{ status: number; data: unknown }>
  write(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<{ status: number; data: unknown }>
  /** espera entre conferências (os testes passam uma versão instantânea) */
  wait?: (ms: number) => Promise<void>
}

const SESSION = '/lol-champ-select/v1/session'
const ok2xx = (n: number): boolean => n >= 200 && n < 300
const LABEL: Record<ActType, string> = { pick: 'escolher', ban: 'banir' }
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type RawAction = { id?: number; completed?: boolean; championId?: number }
const flatActions = (data: unknown): RawAction[] => {
  const a = (data as { actions?: unknown } | null)?.actions
  return Array.isArray(a) ? (a.flat() as RawAction[]) : []
}

/** Campeões que já foram banidos ou escolhidos (ações concluídas): o cliente os recusaria. */
function takenChampions(data: unknown): Set<number> {
  const out = new Set<number>()
  for (const a of flatActions(data)) if (a.completed === true && typeof a.championId === 'number' && a.championId > 0) out.add(a.championId)
  return out
}

/** Valida o pedido vindo da tela (nunca confia no que chega do renderer). */
export function parseActRequest(raw: unknown): ActRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.kind !== 'hover' && r.kind !== 'lock') return null
  if (r.type !== 'pick' && r.type !== 'ban') return null
  if (typeof r.championId !== 'number' || !Number.isInteger(r.championId) || r.championId < 1 || r.championId > 99999) return null
  return { kind: r.kind, type: r.type, championId: r.championId }
}

/** Confere no cliente se a ação do jogador foi mesmo concluída (um 2xx sozinho não prova nada). */
async function confirmed(io: ActIO, actionId: number): Promise<boolean> {
  const wait = io.wait ?? sleep
  for (let i = 0; i < 5; i++) {
    await wait(i === 0 ? 150 : 300)
    const s = await io.get(SESSION).catch(() => null)
    if (!s || s.status !== 200) continue
    const mine = flatActions(s.data).find((a) => a.id === actionId)
    if (mine?.completed === true) return true
  }
  return false
}

export async function actInDraft(io: ActIO, req: ActRequest): Promise<ActResult> {
  const session = await io.get(SESSION)
  if (session.status !== 200) return { ok: false, message: 'A seleção de campeões não está aberta.' }
  const turn = findTurn(session.data)
  if (!turn) return { ok: false, message: `Ainda não é a sua vez de ${LABEL[req.type]}.` }
  if (turn.type !== req.type) return { ok: false, message: turn.type === 'ban' ? 'Agora é a vez de banir, não de escolher.' : 'Agora é a vez de escolher, não de banir.' }
  if (takenChampions(session.data).has(req.championId)) {
    return { ok: false, message: req.type === 'ban' ? 'Esse campeão já foi banido ou escolhido.' : 'Esse campeão já foi banido ou escolhido por alguém.' }
  }

  const path = `/lol-champ-select/v1/session/actions/${turn.id}`
  if (turn.championId !== req.championId) {
    const hover = await io.write('PATCH', path, { championId: req.championId })
    if (!ok2xx(hover.status)) return { ok: false, message: `O cliente recusou a seleção (HTTP ${hover.status}).` }
  }
  if (req.kind === 'hover') return { ok: true, message: req.type === 'ban' ? 'Campeão marcado para banir. Confirme para banir.' : 'Campeão selecionado no cliente. Confirme para travar.' }

  // 1º caminho: completar a própria ação. 2º: o endpoint /complete. Cada um só vale se o cliente confirmar depois.
  const tried: string[] = []
  const first = await io.write('PATCH', path, { championId: req.championId, completed: true })
  tried.push(`PATCH ${first.status}`)
  if (ok2xx(first.status) && (await confirmed(io, turn.id))) return { ok: true, message: req.type === 'ban' ? 'Banimento confirmado.' : 'Campeão travado.' }

  const second = await io.write('POST', `${path}/complete`, { championId: req.championId })
  tried.push(`POST ${second.status}`)
  if (ok2xx(second.status) && (await confirmed(io, turn.id))) return { ok: true, message: req.type === 'ban' ? 'Banimento confirmado.' : 'Campeão travado.' }

  return {
    ok: false,
    message: `O cliente não confirmou ${req.type === 'ban' ? 'o banimento' : 'o pick'} (${tried.join(', ')}). Confirme direto no cliente e envie o diagnóstico para eu ajustar.`
  }
}
