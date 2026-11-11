import { describe, expect, it } from 'vitest'
import { actInDraft, parseActRequest, type ActIO } from '../src/main/lcu/draftAct'
import { findTurn, normalizeSession } from '../src/main/lcu/champSelect'

const session = (actions: unknown[][], local = 1) => ({
  localPlayerCellId: local,
  myTeam: [{ cellId: 0, championId: 0 }, { cellId: 1, championId: 0, assignedPosition: 'middle' }],
  theirTeam: [{ cellId: 5, championId: 0 }],
  actions,
  bans: { myTeamBans: [], theirTeamBans: [] },
  timer: { phase: 'BAN_PICK' }
})
const myPick = (extra: Record<string, unknown> = {}) => ({ id: 7, actorCellId: 1, type: 'pick', championId: 0, completed: false, isInProgress: true, ...extra })
const myBan = (extra: Record<string, unknown> = {}) => ({ id: 3, actorCellId: 1, type: 'ban', championId: 0, completed: false, isInProgress: true, ...extra })

function fakeIo(sess: unknown, lists: { ban?: number[]; pick?: number[] } = {}, failComplete = false) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const io: ActIO = {
    get: async (path) => {
      if (path.endsWith('/session')) return { status: sess ? 200 : 404, data: sess }
      if (path.endsWith('bannable-champion-ids')) return { status: lists.ban ? 200 : 404, data: lists.ban }
      if (path.endsWith('pickable-champion-ids')) return { status: lists.pick ? 200 : 404, data: lists.pick }
      return { status: 404, data: null }
    },
    write: async (method, path, body) => {
      calls.push({ method, path, body })
      if (failComplete && path.endsWith('/complete')) return { status: 500, data: null }
      return { status: 204, data: null }
    }
  }
  return { io, calls }
}

describe('vez do jogador (findTurn / normalizeSession)', () => {
  it('acha a ação em andamento do jogador local', () => {
    expect(findTurn(session([[myBan({ actorCellId: 0, id: 1 })], [myPick()]]))).toEqual({ id: 7, type: 'pick', championId: 0 })
  })
  it('ignora ações de outros, não iniciadas ou concluídas', () => {
    expect(findTurn(session([[{ ...myPick(), actorCellId: 0 }, myPick({ isInProgress: false }), myPick({ completed: true })]]))).toBeNull()
  })
  it('o estado do draft traz a vez (ou null fora dela)', () => {
    expect(normalizeSession(session([[myBan({ championId: 238 })]]))?.turn).toEqual({ id: 3, type: 'ban', championId: 238 })
    expect(normalizeSession(session([[myBan({ isInProgress: false })]]))?.turn ?? null).toBeNull()
  })
})

describe('parseActRequest', () => {
  it('aceita só pedidos bem formados', () => {
    expect(parseActRequest({ kind: 'lock', type: 'ban', championId: 238 })).toEqual({ kind: 'lock', type: 'ban', championId: 238 })
    expect(parseActRequest({ kind: 'auto', type: 'ban', championId: 238 })).toBeNull()
    expect(parseActRequest({ kind: 'lock', type: 'pick', championId: 0 })).toBeNull()
    expect(parseActRequest({ kind: 'lock', type: 'pick', championId: 1.5 })).toBeNull()
    expect(parseActRequest(null)).toBeNull()
  })
})

describe('actInDraft', () => {
  it('não faz nada se a seleção não está aberta ou não é a vez', async () => {
    const a = fakeIo(null)
    expect((await actInDraft(a.io, { kind: 'lock', type: 'pick', championId: 61 })).ok).toBe(false)
    const b = fakeIo(session([[myPick({ isInProgress: false })]]))
    const r = await actInDraft(b.io, { kind: 'lock', type: 'pick', championId: 61 })
    expect(r).toMatchObject({ ok: false })
    expect(r.message).toMatch(/Ainda não é a sua vez/)
    expect(a.calls).toHaveLength(0)
    expect(b.calls).toHaveLength(0)
  })

  it('não escolhe na vez de banir nem bane na vez de escolher', async () => {
    const a = fakeIo(session([[myBan()]]))
    expect((await actInDraft(a.io, { kind: 'lock', type: 'pick', championId: 61 })).message).toMatch(/vez de banir/)
    const b = fakeIo(session([[myPick()]]))
    expect((await actInDraft(b.io, { kind: 'lock', type: 'ban', championId: 61 })).message).toMatch(/vez de escolher/)
    expect(a.calls.length + b.calls.length).toBe(0)
  })

  it('recusa campeão que o cliente não libera', async () => {
    const a = fakeIo(session([[myPick()]]), { pick: [1, 2] })
    const r = await actInDraft(a.io, { kind: 'hover', type: 'pick', championId: 61 })
    expect(r.ok).toBe(false)
    expect(a.calls).toHaveLength(0)
    const b = fakeIo(session([[myBan()]]), { ban: [238] })
    expect((await actInDraft(b.io, { kind: 'lock', type: 'ban', championId: 61 })).ok).toBe(false)
  })

  it('selecionar só marca o campeão (não trava)', async () => {
    const a = fakeIo(session([[myPick()]]), { pick: [61] })
    const r = await actInDraft(a.io, { kind: 'hover', type: 'pick', championId: 61 })
    expect(r.ok).toBe(true)
    expect(a.calls).toEqual([{ method: 'PATCH', path: '/lol-champ-select/v1/session/actions/7', body: { championId: 61 } }])
  })

  it('travar marca e completa a ação do jogador', async () => {
    const a = fakeIo(session([[myPick()]]), { pick: [61] })
    const r = await actInDraft(a.io, { kind: 'lock', type: 'pick', championId: 61 })
    expect(r).toEqual({ ok: true, message: 'Campeão travado.' })
    expect(a.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /lol-champ-select/v1/session/actions/7', 'POST /lol-champ-select/v1/session/actions/7/complete'])
  })

  it('se o campeão já está marcado, só completa; se o complete falha, tenta o plano B', async () => {
    const a = fakeIo(session([[myBan({ championId: 238 })]]), { ban: [238] }, true)
    const r = await actInDraft(a.io, { kind: 'lock', type: 'ban', championId: 238 })
    expect(r).toEqual({ ok: true, message: 'Banimento confirmado.' })
    expect(a.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /lol-champ-select/v1/session/actions/3/complete', 'PATCH /lol-champ-select/v1/session/actions/3'])
    expect(a.calls[1].body).toEqual({ championId: 238, completed: true })
  })
})
