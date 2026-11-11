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
}

const SESSION = '/lol-champ-select/v1/session'
const ok2xx = (n: number): boolean => n >= 200 && n < 300
const LABEL: Record<ActType, string> = { pick: 'escolher', ban: 'banir' }

/** Valida o pedido vindo da tela (nunca confia no que chega do renderer). */
export function parseActRequest(raw: unknown): ActRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.kind !== 'hover' && r.kind !== 'lock') return null
  if (r.type !== 'pick' && r.type !== 'ban') return null
  if (typeof r.championId !== 'number' || !Number.isInteger(r.championId) || r.championId < 1 || r.championId > 99999) return null
  return { kind: r.kind, type: r.type, championId: r.championId }
}

export async function actInDraft(io: ActIO, req: ActRequest): Promise<ActResult> {
  const session = await io.get(SESSION)
  if (session.status !== 200) return { ok: false, message: 'A seleção de campeões não está aberta.' }
  const turn = findTurn(session.data)
  if (!turn) return { ok: false, message: `Ainda não é a sua vez de ${LABEL[req.type]}.` }
  if (turn.type !== req.type) return { ok: false, message: turn.type === 'ban' ? 'Agora é a vez de banir, não de escolher.' : 'Agora é a vez de escolher, não de banir.' }

  // O cliente sabe quais campeões estão liberados (donos, banidos, já escolhidos): se ele responde, a lista manda.
  const list = await io.get(req.type === 'ban' ? '/lol-champ-select/v1/bannable-champion-ids' : '/lol-champ-select/v1/pickable-champion-ids').catch(() => null)
  if (list && list.status === 200 && Array.isArray(list.data) && !list.data.includes(req.championId)) {
    return { ok: false, message: req.type === 'ban' ? 'Esse campeão não pode ser banido agora (já banido ou escolhido).' : 'Esse campeão não está disponível para você (banido, já escolhido ou não liberado).' }
  }

  const path = `/lol-champ-select/v1/session/actions/${turn.id}`
  if (turn.championId !== req.championId) {
    const hover = await io.write('PATCH', path, { championId: req.championId })
    if (!ok2xx(hover.status)) return { ok: false, message: `O cliente recusou a seleção (HTTP ${hover.status}).` }
  }
  if (req.kind === 'hover') return { ok: true, message: req.type === 'ban' ? 'Campeão marcado para banir. Confirme para banir.' : 'Campeão selecionado no cliente. Confirme para travar.' }

  let done = await io.write('POST', `${path}/complete`, { championId: req.championId })
  if (!ok2xx(done.status)) {
    // Plano B conhecido da LCU: completar pela própria ação.
    done = await io.write('PATCH', path, { championId: req.championId, completed: true })
  }
  if (!ok2xx(done.status)) return { ok: false, message: `O cliente recusou ${req.type === 'ban' ? 'o banimento' : 'travar o campeão'} (HTTP ${done.status}).` }
  return { ok: true, message: req.type === 'ban' ? 'Banimento confirmado.' : 'Campeão travado.' }
}
