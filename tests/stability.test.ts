// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MetaStore, MetaUpdateError } from '../src/main/data/meta'
import { PostGameStore } from '../src/main/postgame/store'
import { analyzeMatch } from '../src/shared/postgame'
import { normalizeMatch } from '../src/main/postgame/normalize'
import { makeLcuMatch } from './fixtures/match'

const SAMPLE = join(process.cwd(), 'resources', 'meta.sample.json')
const body = JSON.stringify({
  schemaVersion: 1,
  source: 'x',
  patch: '16.20',
  generatedAt: '2026-10-27T10:00:00Z',
  champions: { '103': { roles: { MIDDLE: { games: 50, wins: 27, matchups: {} } } } }
})

describe('atualização do meta: redirecionamentos', () => {
  const mk = async (): Promise<MetaStore> => {
    const s = new MetaStore(join(mkdtempSync(join(tmpdir(), 'rd-')), 'meta.json'), SAMPLE)
    await s.load()
    return s
  }
  const redirect = (to: string): Response => new Response(null, { status: 302, headers: { location: to } })

  it('segue redirecionamento https e baixa do destino', async () => {
    const calls: string[] = []
    const fetchFn = (async (u: string) => {
      calls.push(u)
      return calls.length === 1 ? redirect('https://cdn.test/meta.json') : new Response(body, { status: 200 })
    }) as unknown as typeof fetch
    const r = await (await mk()).updateFromUrl('https://a.test/meta.json', fetchFn)
    expect(r.changed).toBe(true)
    expect(calls).toEqual(['https://a.test/meta.json', 'https://cdn.test/meta.json'])
  })

  it('recusa redirecionamento para http antes de baixar qualquer coisa', async () => {
    const calls: string[] = []
    const fetchFn = (async (u: string) => {
      calls.push(u)
      return redirect('http://evil.test/meta.json')
    }) as unknown as typeof fetch
    await expect((await mk()).updateFromUrl('https://a.test/meta.json', fetchFn)).rejects.toBeInstanceOf(MetaUpdateError)
    expect(calls).toHaveLength(1)
  })

  it('desiste de redirecionamentos em cadeia', async () => {
    const fetchFn = (async () => redirect('https://loop.test/meta.json')) as unknown as typeof fetch
    await expect((await mk()).updateFromUrl('https://a.test/meta.json', fetchFn)).rejects.toThrow('Redirecionamentos demais')
  })
})

describe('histórico do pós-jogo: gravação segura', () => {
  it('uma gravação que falha não trava as seguintes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'))
    const file = join(dir, 'history.json')
    const report = normalizeMatch(makeLcuMatch())!
    const analysis = analyzeMatch(report)!
    const store = new PostGameStore(file, join(dir, 'raw'))

    // Um diretório no lugar do arquivo faz o rename falhar (como um antivírus segurando o arquivo).
    mkdirSync(file)
    await expect(store.put(report, analysis)).rejects.toBeTruthy()
    const { rmSync } = await import('node:fs')
    rmSync(file, { recursive: true, force: true })

    await store.put({ ...report, gameId: report.gameId + 1 }, analysis)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { items: { report: { gameId: number } }[] }
    expect(saved.items.some((i) => i.report.gameId === report.gameId + 1)).toBe(true)
  })
})
