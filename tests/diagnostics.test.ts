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
    expect(lines).toHaveLength(PROBE_PATHS.length + 1) // + conjuntos de itens (sem conta lida, falha)
    const text = formatProbe(lines)
    expect(text[0]).toMatch(/^OK .*HTTP 200/)
    expect(text[1]).toMatch(/sem resposta/)
    expect(text[2]).toMatch(/^-- .*HTTP 404/)
  })

  it('só marca 404 como normal nas fases; no resto é erro, e testa conjuntos de itens e Live Client', async () => {
    const seen: string[] = []
    const lines = await probeClient({
      get: async (p) => {
        seen.push(p)
        if (p.includes('current-summoner')) return { status: 200, data: { summonerId: 123456 } }
        if (p.includes('champion-mastery')) return { status: 404, data: null } // deveria existir sempre: erro
        if (p.includes('champ-select') || p.includes('end-of-game')) return { status: 404, data: null } // normal
        return { status: 200, data: [] }
      },
      live: async () => false
    })
    expect(seen).toContain('/lol-item-sets/v1/item-sets/123456/sets')
    const text = formatProbe(lines)
    expect(text.find((l) => l.includes('Maestria'))).toMatch(/^ERR /)
    expect(text.find((l) => l.includes('Seleção de campeões'))).toMatch(/^-- /)
    expect(text.find((l) => l.includes('Conjuntos de itens'))).toMatch(/^OK /)
    expect(text.find((l) => l.includes('Live Client'))).toMatch(/^-- .*fora da partida/)
    expect(text[text.length - 1]).toMatch(/1 item\(ns\) com ERR/)
  })

  it('com tudo funcionando o resumo diz que não há erro', async () => {
    const text = formatProbe(
      await probeClient({
        get: async (p) => (p.includes('current-summoner') ? { status: 200, data: { summonerId: '77' } } : { status: p.includes('champ-select') || p.includes('end-of-game') ? 404 : 200, data: [] }),
        live: async () => true
      })
    )
    expect(text[text.length - 1]).toMatch(/nada com erro/)
    expect(text.find((l) => l.includes('Live Client'))).toMatch(/^OK /)
  })
})
