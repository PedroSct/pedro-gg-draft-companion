import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoAccept } from '../src/main/autoAccept'
import { sanitizeSettingsPatch } from '../src/main/store/profiles'

const open = { state: 'InProgress', playerResponse: 'None' }

function make(enabled = true, delay = 1) {
  const accept = vi.fn(async () => ({ ok: true, status: 204 }))
  const onAccepted = vi.fn()
  const cfg = { enabled, delay }
  const aa = new AutoAccept({ isEnabled: () => cfg.enabled, getDelaySec: () => cfg.delay, accept, onAccepted })
  return { aa, accept, onAccepted, cfg }
}

describe('AutoAccept', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('aceita depois da espera', async () => {
    const { aa, accept, onAccepted } = make()
    aa.update(open)
    await vi.advanceTimersByTimeAsync(999)
    expect(accept).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(accept).toHaveBeenCalledTimes(1)
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })

  it('não aceita com a opção desligada', async () => {
    const { aa, accept } = make(false)
    aa.update(open)
    await vi.advanceTimersByTimeAsync(5000)
    expect(accept).not.toHaveBeenCalled()
  })

  it('aceita uma vez só mesmo com vários eventos da mesma janela', async () => {
    const { aa, accept } = make(true, 0)
    aa.update(open)
    aa.update(open)
    aa.update(open)
    await vi.advanceTimersByTimeAsync(10)
    expect(accept).toHaveBeenCalledTimes(1)
  })

  it('não aceita se você aceitou ou recusou antes', async () => {
    const { aa, accept } = make()
    aa.update(open)
    aa.update({ state: 'InProgress', playerResponse: 'Accepted' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(accept).not.toHaveBeenCalled()
  })

  it('não aceita se a janela fechou (alguém recusou)', async () => {
    const { aa, accept } = make()
    aa.update(open)
    aa.update(null)
    await vi.advanceTimersByTimeAsync(5000)
    expect(accept).not.toHaveBeenCalled()
  })

  it('desligar durante a espera cancela', async () => {
    const { aa, accept, cfg } = make()
    aa.update(open)
    cfg.enabled = false
    aa.enabledChanged()
    await vi.advanceTimersByTimeAsync(5000)
    expect(accept).not.toHaveBeenCalled()
  })

  it('ligar com a janela já aberta aceita', async () => {
    const { aa, accept, cfg } = make(false, 0)
    aa.update(open)
    cfg.enabled = true
    aa.enabledChanged()
    await vi.advanceTimersByTimeAsync(10)
    expect(accept).toHaveBeenCalledTimes(1)
  })

  it('a próxima partida encontrada é aceita de novo', async () => {
    const { aa, accept } = make(true, 0)
    aa.update(open)
    await vi.advanceTimersByTimeAsync(10)
    aa.update(null)
    aa.update(open)
    await vi.advanceTimersByTimeAsync(10)
    expect(accept).toHaveBeenCalledTimes(2)
  })

  it('erro ao aceitar não derruba nem conta como aceito', async () => {
    const accept = vi.fn(async (): Promise<{ ok: boolean; status: number }> => {
      throw new Error('cliente fechou')
    })
    const onAccepted = vi.fn()
    const aa = new AutoAccept({ isEnabled: () => true, getDelaySec: () => 0, accept, onAccepted })
    aa.update(open)
    await vi.advanceTimersByTimeAsync(10)
    expect(onAccepted).not.toHaveBeenCalled()
  })
})

describe('configurações do aceite automático', () => {
  it('valida e limita a espera', () => {
    expect(sanitizeSettingsPatch({ autoAccept: true, autoAcceptDelay: 99 })).toEqual({ autoAccept: true, autoAcceptDelay: 8 })
    expect(sanitizeSettingsPatch({ autoAcceptDelay: -3 })).toEqual({ autoAcceptDelay: 0 })
    expect(() => sanitizeSettingsPatch({ autoAccept: 'sim' })).toThrow()
    expect(() => sanitizeSettingsPatch({ autoAcceptDelay: 'x' })).toThrow()
  })
})

describe('AutoAccept: tentativas', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('tenta de novo quando o cliente recusa o aceite e para quando consegue', async () => {
    const results = [{ ok: false, status: 500 }, { ok: false, status: 404 }, { ok: true, status: 204 }]
    const accept = vi.fn(async () => results.shift()!)
    const attempts: number[] = []
    const onAccepted = vi.fn()
    const aa = new AutoAccept({ isEnabled: () => true, getDelaySec: () => 0, accept, onAccepted, onAttempt: (i) => attempts.push(i.status), retryMs: 100 })
    aa.update(open)
    await vi.advanceTimersByTimeAsync(1000)
    expect(attempts).toEqual([500, 404, 204])
    expect(onAccepted).toHaveBeenCalledTimes(1)
  })

  it('desiste depois do máximo de tentativas', async () => {
    const accept = vi.fn(async () => ({ ok: false, status: 404 }))
    const onAccepted = vi.fn()
    const aa = new AutoAccept({ isEnabled: () => true, getDelaySec: () => 0, accept, onAccepted, maxAttempts: 3, retryMs: 50 })
    aa.update(open)
    await vi.advanceTimersByTimeAsync(2000)
    expect(accept).toHaveBeenCalledTimes(3)
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it('para de tentar se você aceitar à mão no meio', async () => {
    const accept = vi.fn(async () => ({ ok: false, status: 500 }))
    const aa = new AutoAccept({ isEnabled: () => true, getDelaySec: () => 0, accept, onAccepted: () => {}, retryMs: 100 })
    aa.update(open)
    await vi.advanceTimersByTimeAsync(10)
    aa.update({ state: 'InProgress', playerResponse: 'Accepted' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(accept).toHaveBeenCalledTimes(1)
  })
})
