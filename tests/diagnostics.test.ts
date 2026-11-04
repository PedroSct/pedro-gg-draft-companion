import { describe, expect, it } from 'vitest'
import { formatProbe, probeClient, PROBE_PATHS } from '../src/main/diagnostics'

describe('probeClient', () => {
  it('consulta todos os endpoints e marca ok / 404 / sem resposta', async () => {
    const lines = await probeClient({
      get: async (p) => {
        if (p.includes('gameflow')) return { status: 200, data: 'None' }
        if (p.includes('summoner')) throw new Error('boom')
        return { status: 404, data: null }
      }
    })
    expect(lines).toHaveLength(PROBE_PATHS.length)
    const text = formatProbe(lines)
    expect(text[0]).toMatch(/^OK .*HTTP 200/)
    expect(text[1]).toMatch(/sem resposta/)
    expect(text[2]).toMatch(/^-- .*HTTP 404/)
  })
})
