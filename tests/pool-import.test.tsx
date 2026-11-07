import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AccountPoolDialog } from '../src/renderer/src/components/AccountPoolDialog'
import { applySuggestion, buildPoolSuggestion, comfortFor, type AccountGame, type PoolSuggestResult } from '../src/shared/poolImport'
import { gamesOf, parseGame, parseMastery, suggestPoolFromAccount } from '../src/main/lcu/accountPool'
import type { Pool } from '../src/shared/dataTypes'

const emptyPool = (): Pool => ({ TOP: [], JUNGLE: [], MIDDLE: [], BOTTOM: [], UTILITY: [] })
const g = (championId: number, role: AccountGame['role'], win: boolean, n = 1): AccountGame[] => Array.from({ length: n }, () => ({ championId, role, win }))

describe('conforto automático', () => {
  it('cresce com partidas na rota, maestria e vitórias, e fica entre 1 e 5', () => {
    expect(comfortFor(0, 0, 0)).toBe(1)
    expect(comfortFor(2, 1, 0)).toBe(1)
    expect(comfortFor(6, 3, 0)).toBe(2)
    expect(comfortFor(12, 7, 0)).toBe(3) // 1 + 1,5; 58% de vitórias não ganha bônus
    expect(comfortFor(15, 10, 350_000)).toBe(5)
    expect(comfortFor(0, 0, 120_000)).toBe(2)
    expect(comfortFor(10, 3, 0)).toBe(2) // 1 + 1 − 0,5
  })
  it('quem é main não cai por causa da taxa de vitória', () => {
    expect(comfortFor(25, 8, 400_000)).toBe(5) // 32% de vitórias, mas 25 partidas e 400 mil pontos
    expect(comfortFor(14, 4, 150_000)).toBe(4) // 29% de vitórias: o piso de 4 vale
    expect(comfortFor(14, 5, 150_000)).toBe(4)
    expect(comfortFor(0, 0, 650_000)).toBe(3) // 1 + 2: só maestria, sem prática recente
  })
  it('"mono" (40% ou mais das partidas da rota) ganha meia estrela', () => {
    expect(comfortFor(9, 4, 0, 0.5)).toBe(3) // 1 + 1 + 0,5
    expect(comfortFor(9, 4, 0, 0.2)).toBe(2)
    expect(comfortFor(5, 3, 0, 1)).toBe(2) // poucas partidas: não conta como mono
  })
})

describe('sugestão de Pool', () => {
  const games = [...g(103, 'MIDDLE', true, 8), ...g(103, 'MIDDLE', false, 2), ...g(238, 'MIDDLE', false, 3), ...g(99, 'UTILITY', true, 2), ...g(11, 'JUNGLE', true, 1), ...g(1, null, true, 3)]
  const mastery = [{ championId: 103, points: 150_000, level: 7 }, { championId: 134, points: 90_000, level: 6 }, { championId: 22, points: 60_000, level: 6 }, { championId: 11, points: 3_000, level: 3 }]
  const s = buildPoolSuggestion(games, mastery, (id) => (id === 134 ? 'MIDDLE' : id === 22 ? 'BOTTOM' : null))

  it('agrupa por rota, ignora partidas sem rota e com menos de 2 jogos', () => {
    expect(s.gamesUsed).toBe(16)
    expect(s.byRole.MIDDLE.map((c) => c.championId)).toEqual([103, 238, 134])
    expect(s.byRole.MIDDLE[0]).toMatchObject({ championId: 103, games: 10, wins: 8 })
    expect(s.byRole.JUNGLE).toEqual([]) // só 1 partida e pouca maestria
    expect(s.byRole.UTILITY.map((c) => c.championId)).toEqual([99])
  })
  it('maestria alta sem partidas entra na rota mais comum do campeão; sem dica de rota, fica de fora', () => {
    expect(s.byRole.MIDDLE.some((c) => c.championId === 134 && c.games === 0)).toBe(true)
    expect(s.byRole.BOTTOM.map((c) => c.championId)).toEqual([22])
    const none = buildPoolSuggestion([], [{ championId: 22, points: 60_000, level: 6 }], () => null)
    expect(none.byRole.BOTTOM).toEqual([])
  })
  it('rotas principais: as que somam 20% ou mais das partidas', () => {
    expect(s.mainRoles).toEqual(['MIDDLE'])
  })
  it('aplicar mantém o que existe (e o conforto) e só atualiza o conforto se pedir', () => {
    const pool = emptyPool()
    pool.MIDDLE = [{ championId: 103, championKey: 'Ahri', comfort: 2, notes: 'minha main' }]
    const picked = [...s.byRole.MIDDLE]
    const keep = applySuggestion(pool, picked, (id) => `K${id}`, { updateComfort: false })
    expect(keep.MIDDLE.find((e) => e.championId === 103)).toMatchObject({ comfort: 2, notes: 'minha main' })
    expect(keep.MIDDLE.find((e) => e.championId === 134)).toMatchObject({ championKey: 'K134' })
    const upd = applySuggestion(pool, picked, (id) => `K${id}`, { updateComfort: true })
    expect(upd.MIDDLE.find((e) => e.championId === 103)?.comfort).toBe(s.byRole.MIDDLE.find((c) => c.championId === 103)?.comfort)
    expect(upd.MIDDLE.find((e) => e.championId === 103)?.notes).toBe('minha main')
    expect(pool.MIDDLE).toHaveLength(1) // não altera o original
  })
})

describe('leitura do cliente', () => {
  const lcuGame = (queueId: number, championId: number, lane: string, role: string, win: boolean) => ({ queueId, participants: [{ championId, stats: { win }, timeline: { lane, role } }] })
  it('aceita as formas da lista e converte rota/vitória; ignora ARAM e bots', () => {
    expect(gamesOf({ games: { games: [1, 2] } })).toEqual([1, 2])
    expect(gamesOf({ games: [3] })).toEqual([3])
    expect(gamesOf([4])).toEqual([4])
    expect(gamesOf(null)).toEqual([])
    expect(parseGame(lcuGame(420, 103, 'MIDDLE', 'SOLO', true))).toEqual({ championId: 103, role: 'MIDDLE', win: true })
    expect(parseGame(lcuGame(420, 412, 'BOTTOM', 'DUO_SUPPORT', false))).toEqual({ championId: 412, role: 'UTILITY', win: false })
    expect(parseGame(lcuGame(450, 103, 'MIDDLE', 'SOLO', true))).toBeNull() // ARAM
    expect(parseGame(lcuGame(830, 103, 'MIDDLE', 'SOLO', true))).toBeNull() // bots
    expect(parseGame({ participants: [] })).toBeNull()
  })
  it('lê a maestria', () => {
    expect(parseMastery([{ championId: 103, championPoints: 12345, championLevel: 5 }, { championId: 0 }, 'x'])).toEqual([{ championId: 103, points: 12345, level: 5 }])
  })
  it('junta histórico e maestria; explica quando o cliente não responde', async () => {
    const page = (n: number) => ({ games: { games: Array.from({ length: n }, () => lcuGame(420, 103, 'MIDDLE', 'SOLO', true)) } })
    const calls: string[] = []
    const get = vi.fn(async (path: string) => {
      calls.push(path)
      if (path.includes('current-summoner') && !path.includes('matches')) return { status: 200, data: { gameName: 'Pedro', tagLine: 'BR1' } }
      if (path.includes('begIndex=0')) return { status: 200, data: page(20) }
      if (path.includes('begIndex=20')) return { status: 200, data: page(5) }
      if (path.includes('mastery')) return { status: 200, data: [{ championId: 103, championPoints: 200_000, championLevel: 7 }] }
      return { status: 404, data: {} }
    })
    const r = await suggestPoolFromAccount(get, () => null)
    expect(r.ok && r.account).toBe('Pedro#BR1')
    expect(r.ok && r.suggestion.gamesUsed).toBe(25)
    expect(calls.filter((c) => c.includes('matches?'))).toHaveLength(2) // parou na página incompleta
    const down = await suggestPoolFromAccount(async () => ({ status: 503, data: null }), () => null)
    expect(down.ok).toBe(false)
  })
})

describe('diálogo Importar da minha conta', () => {
  const suggestion = buildPoolSuggestion([...g(103, 'MIDDLE', true, 8), ...g(238, 'MIDDLE', false, 3)], [], () => null)
  function mount(result: PoolSuggestResult, pool = emptyPool()) {
    window.api = { suggestPoolFromAccount: vi.fn(async () => result) } as never
    const onApply = vi.fn()
    render(<AccountPoolDialog pool={pool} mainRoles={[]} onApply={onApply} onClose={() => undefined} />)
    return onApply
  }

  it('mostra a sugestão, deixa desmarcar e entrega só o que foi marcado', async () => {
    const user = userEvent.setup()
    const onApply = mount({ ok: true, account: 'Pedro#BR1', suggestion })
    expect(await screen.findByText(/Pedro#BR1/)).toBeTruthy()
    const mid = screen.getByRole('region', { name: 'Meio' })
    const boxes = within(mid).getAllByRole('checkbox')
    expect(boxes).toHaveLength(2)
    await user.click(boxes[1]) // desmarca o segundo
    await user.click(screen.getByRole('button', { name: 'Adicionar à Pool' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    const [picked, opts] = onApply.mock.calls[0]
    expect(picked.map((c: { championId: number }) => c.championId)).toEqual([103])
    expect(opts).toEqual({ updateComfort: false, mainRoles: ['MIDDLE'] })
  })
  it('quem já está na Pool vem desmarcado e identificado', async () => {
    const pool = emptyPool()
    pool.MIDDLE = [{ championId: 103, championKey: 'Ahri', comfort: 3 }]
    mount({ ok: true, account: null, suggestion }, pool)
    await screen.findByRole('region', { name: 'Meio' })
    expect(screen.getByText('já na Pool')).toBeTruthy()
    const boxes = within(screen.getByRole('region', { name: 'Meio' })).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((b) => b.checked)).toEqual([false, true])
  })
  it('mostra o motivo quando o cliente não responde e deixa tentar de novo', async () => {
    mount({ ok: false, message: 'Abra o League of Legends e entre na sua conta para importar.' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Abra o League of Legends')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy())
  })
})
