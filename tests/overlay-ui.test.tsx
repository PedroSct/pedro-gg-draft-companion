import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Overlay from '../src/renderer/src/components/Overlay'
import type { OverlayState } from '../src/shared/overlay'

const state = (over: Partial<OverlayState> = {}): OverlayState => ({
  demo: false, championId: 103, championName: 'Ahri', role: 'MIDDLE', level: 7, gameTime: 612, lowData: false,
  skill: { next: 'R', ready: true, upcoming: ['Q', 'E', 'Q'], levels: { Q: 3, W: 1, E: 1, R: 0 }, priority: ['R', 'Q', 'E', 'W'] },
  nextItemId: 4645,
  items: [
    { itemId: 6655, label: 'Item 1', owned: true },
    { itemId: 4645, label: 'Item 2', owned: false },
    { itemId: 3157, label: 'Situacional', owned: false }
  ],
  ...over
})

function mount(initial: OverlayState | null) {
  let push: (s: OverlayState | null) => void = () => undefined
  window.api = {
    getOverlayState: vi.fn(async () => initial),
    onOverlayState: vi.fn((cb: (s: OverlayState | null) => void) => { push = cb; return () => undefined }),
    getCatalog: vi.fn(async () => ({
      version: '16.22.1', locale: 'pt_BR', champions: [{ id: 103, key: 'Ahri', name: 'Ahri', iconUrl: '', tags: [], info: { attack: 1, defense: 1, magic: 1, difficulty: 1 } }],
      items: { '4645': { id: 4645, name: 'Chama Sombria', iconUrl: '', gold: 0 }, '6655': { id: 6655, name: 'Ruína de Luden', iconUrl: '', gold: 0 } }
    }))
  } as never
  render(<Overlay />)
  return (s: OverlayState | null) => act(() => push(s))
}

afterEach(() => document.documentElement.classList.remove('overlay-mode'))

describe('Overlay (painel no jogo)', () => {
  it('mostra a habilidade a subir agora e o próximo item a comprar', async () => {
    mount(state())
    expect(await screen.findByText('Suba agora: R')).toBeTruthy()
    expect(await screen.findByText('Comprar: Chama Sombria')).toBeTruthy()
    expect(screen.getByText('Depois: Q → E → Q')).toBeTruthy()
    expect(screen.getByText('Situ.')).toBeTruthy()
    expect(document.documentElement.classList.contains('overlay-mode')).toBe(true)
  })
  it('sem ponto para gastar mostra "Próxima"; poucos dados e demonstração são sinalizados', async () => {
    mount(state({ demo: true, lowData: true, skill: { ...state().skill, ready: false } }))
    expect(await screen.findByText('Próxima: R')).toBeTruthy()
    expect(screen.getByText(/demonstração/)).toBeTruthy()
    expect(screen.getByText(/Poucos dados/)).toBeTruthy()
  })
  it('não desenha nada sem partida e reage a novas atualizações', async () => {
    const push = mount(null)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('region')).toBeNull()
    push(state())
    expect(await screen.findByText('Suba agora: R')).toBeTruthy()
    push(state({ nextItemId: null, items: [] }))
    expect(screen.queryByText(/Comprar:/)).toBeNull()
  })
})
