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

/** Cliente falso: PATCH com completed:true e POST /complete concluem a ação, a menos que `ignore` diga o contrário. */
function fakeIo(sess: ReturnType<typeof session> | null, opts: { ignorePatchComplete?: boolean; ignoreAll?: boolean; patchStatus?: number } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const find = (id: number) => sess?.actions.flat().find((a) => (a as { id: number }).id === id) as Record<string, unknown> | undefined
  const io: ActIO = {
    wait: async () => {},
    get: async (path) => ({ status: sess && path.endsWith('/session') ? 200 : 404, data: sess }),
    write: async (method, path, body) => {
      calls.push({ method, path, body })
      const id = Number(/actions\/(\d+)/.exec(path)?.[1])
      const act = find(id)
      const b = body as { championId?: number; completed?: boolean }
      if (opts.patchStatus && method === 'PATCH') return { status: opts.patchStatus, data: null }
      if (act && b.championId) act.championId = b.championId
      if (act && !opts.ignoreAll) {
        if (method === 'PATCH' && b.completed && !opts.ignorePatchComplete) act.completed = true
        if (method === 'POST' && path.endsWith('/complete')) act.completed = true
      }
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

  it('recusa campeão que já foi banido ou escolhido (pela própria seleção), sem depender das listas do cliente', async () => {
    const a = fakeIo(session([[{ id: 1, actorCellId: 0, type: 'ban', championId: 61, completed: true, isInProgress: false }], [myBan()]]))
    const r = await actInDraft(a.io, { kind: 'lock', type: 'ban', championId: 61 })
    expect(r.ok).toBe(false)
    expect(a.calls).toHaveLength(0)
  })

  it('campeão livre é aceito mesmo que o cliente não tenha lista de liberados', async () => {
    const a = fakeIo(session([[myBan()]]))
    expect((await actInDraft(a.io, { kind: 'lock', type: 'ban', championId: 238 })).ok).toBe(true)
  })

  it('selecionar só marca o campeão (não trava)', async () => {
    const a = fakeIo(session([[myPick()]]))
    const r = await actInDraft(a.io, { kind: 'hover', type: 'pick', championId: 61 })
    expect(r.ok).toBe(true)
    expect(a.calls).toEqual([{ method: 'PATCH', path: '/lol-champ-select/v1/session/actions/7', body: { championId: 61 } }])
  })

  it('travar marca e completa a ação, e só diz que travou depois que o cliente confirma', async () => {
    const a = fakeIo(session([[myPick()]]))
    const r = await actInDraft(a.io, { kind: 'lock', type: 'pick', championId: 61 })
    expect(r).toEqual({ ok: true, message: 'Campeão travado.' })
    expect(a.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /lol-champ-select/v1/session/actions/7', 'PATCH /lol-champ-select/v1/session/actions/7'])
    expect(a.calls[1].body).toEqual({ championId: 61, completed: true })
  })

  it('se o PATCH não conclui, tenta o /complete e confirma', async () => {
    const a = fakeIo(session([[myBan({ championId: 238 })]]), { ignorePatchComplete: true })
    const r = await actInDraft(a.io, { kind: 'lock', type: 'ban', championId: 238 })
    expect(r).toEqual({ ok: true, message: 'Banimento confirmado.' })
    expect(a.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /lol-champ-select/v1/session/actions/3', 'POST /lol-champ-select/v1/session/actions/3/complete'])
  })

  it('um 2xx que o cliente não confirma NÃO vira "travado"', async () => {
    const a = fakeIo(session([[myPick()]]), { ignoreAll: true })
    const r = await actInDraft(a.io, { kind: 'lock', type: 'pick', championId: 61 })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/não confirmou/)
    expect(r.message).toMatch(/PATCH 204, POST 204/)
  })

  it('cliente recusando a seleção (erro HTTP) é relatado', async () => {
    const a = fakeIo(session([[myPick()]]), { patchStatus: 500 })
    const r = await actInDraft(a.io, { kind: 'lock', type: 'pick', championId: 61 })
    expect(r).toMatchObject({ ok: false })
    expect(r.message).toMatch(/HTTP 500/)
  })
})
