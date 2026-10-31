// src/main/lcu/loadout.ts
// "Importar para o cliente": coloca as runas, os feitiços e os itens recomendados da partida no cliente do LoL.
// Só acontece quando o usuário clica; o app mexe apenas na página "Pedro.gg" e no conjunto de itens "Pedro.gg".
import type { ChampionBuild } from '../../shared/dataTypes'
import type { Role } from '../../shared/types'
import type { LoadoutParts, LoadoutResult, PartResult } from '../../shared/loadout'

export type { LoadoutParts, LoadoutResult, PartResult }

export const PAGE_PREFIX = 'Pedro.gg'
const SET_UID_PREFIX = 'pedrogg-'
const FLASH = 4

export interface LoadoutIO {
  get(path: string): Promise<{ status: number; data: unknown }>
  write(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown): Promise<{ status: number; data: unknown }>
}

export interface LoadoutInput {
  championId: number
  championName: string
  role: Role
  build: ChampionBuild
  parts: LoadoutParts
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const ok2xx = (status: number): boolean => status >= 200 && status < 300

async function importRunes(io: LoadoutIO, input: LoadoutInput): Promise<PartResult> {
  const runes = input.build.runes
  if (!runes) return { ok: false, message: 'O dataset não tem runas para este campeão. Atualize os dados de meta.' }
  const name = `${PAGE_PREFIX} ${input.championName}`.slice(0, 25)
  const body = { name, primaryStyleId: runes.primaryStyleId, subStyleId: runes.subStyleId, selectedPerkIds: runes.perkIds, current: true }

  const list = await io.get('/lol-perks/v1/pages')
  const pages = list.status === 200 && Array.isArray(list.data) ? list.data.filter(isRecord) : []
  const mine = pages.find((p) => typeof p.name === 'string' && p.name.startsWith(PAGE_PREFIX) && p.isEditable !== false && typeof p.id === 'number')

  let pageId: number | null = null
  if (mine) {
    const res = await io.write('PUT', `/lol-perks/v1/pages/${mine.id as number}`, body)
    if (!ok2xx(res.status)) return { ok: false, message: `O cliente recusou a página de runas (HTTP ${res.status}).` }
    pageId = mine.id as number
  } else {
    const res = await io.write('POST', '/lol-perks/v1/pages', body)
    if (!ok2xx(res.status)) {
      return {
        ok: false,
        message: `Não consegui criar a página de runas (HTTP ${res.status}). Se todas as suas páginas estão em uso, renomeie uma para “${PAGE_PREFIX}” e tente de novo: o app só mexe nessa.`
      }
    }
    pageId = isRecord(res.data) && typeof res.data.id === 'number' ? res.data.id : null
  }
  if (pageId !== null) await io.write('PUT', '/lol-perks/v1/currentpage', pageId).catch(() => undefined)
  return { ok: true, message: `Runas aplicadas na página “${name}”.` }
}

async function importSpells(io: LoadoutIO, input: LoadoutInput): Promise<PartResult> {
  const spells = input.build.spells
  if (!spells) return { ok: false, message: 'O dataset não tem feitiços para este campeão.' }
  // Flash fica no F (segundo), como a maioria prefere.
  const [a, b] = spells[0] === FLASH ? [spells[1], spells[0]] : spells
  const res = await io.write('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id: a, spell2Id: b })
  if (res.status === 404) return { ok: false, message: 'Os feitiços só podem ser trocados durante a seleção de campeões.' }
  if (!ok2xx(res.status)) return { ok: false, message: `O cliente recusou os feitiços (HTTP ${res.status}).` }
  return { ok: true, message: 'Feitiços de invocador trocados.' }
}

export function itemSetFor(input: LoadoutInput): Record<string, unknown> {
  const { items } = input.build
  const block = (type: string, ids: number[]) => ({ type, items: ids.map((id) => ({ id: String(id), count: 1 })), hideIfSummonerSpell: '', showIfSummonerSpell: '' })
  const blocks = [
    block('Inicial', items.starting),
    block('Botas', items.boots.slice(0, 1)),
    block('Itens principais, na ordem', items.core),
    block('Situacionais', items.situational.map((s) => s.itemId))
  ].filter((b) => b.items.length > 0)
  return {
    uid: `${SET_UID_PREFIX}${input.championId}`,
    title: `${PAGE_PREFIX} ${input.championName}`.slice(0, 40),
    type: 'custom',
    map: 'any',
    mode: 'any',
    sortrank: 0,
    startedFrom: 'blank',
    associatedChampions: [input.championId],
    associatedMaps: [11],
    blocks
  }
}

async function importItems(io: LoadoutIO, input: LoadoutInput): Promise<PartResult> {
  const set = itemSetFor(input)
  if ((set.blocks as unknown[]).length === 0) return { ok: false, message: 'O dataset não tem itens para este campeão.' }

  const me = await io.get('/lol-summoner/v1/current-summoner')
  const d = isRecord(me.data) ? me.data : {}
  const summonerId = typeof d.summonerId === 'number' || typeof d.summonerId === 'string' ? String(d.summonerId) : ''
  if (!/^\d{1,20}$/.test(summonerId)) return { ok: false, message: 'Não consegui identificar sua conta no cliente.' }
  const path = `/lol-item-sets/v1/item-sets/${summonerId}/sets`

  const cur = await io.get(path)
  const data = isRecord(cur.data) ? cur.data : {}
  const existing = Array.isArray(data.itemSets) ? data.itemSets.filter(isRecord) : []
  // Troca só o conjunto deste campeão que o próprio app criou antes; os seus ficam como estão.
  const kept = existing.filter((x) => x.uid !== set.uid)
  const accountId = data.accountId ?? d.accountId
  const res = await io.write('PUT', path, { ...(accountId !== undefined ? { accountId } : {}), itemSets: [...kept, set], timestamp: Date.now() })
  if (!ok2xx(res.status)) return { ok: false, message: `O cliente recusou o conjunto de itens (HTTP ${res.status}).` }
  return { ok: true, message: `Conjunto de itens “${String(set.title)}” salvo. Ele aparece na loja durante a partida.` }
}

/** Aplica só o que o usuário marcou; cada parte falha sozinha, sem impedir as outras. */
export async function applyLoadout(io: LoadoutIO, input: LoadoutInput): Promise<LoadoutResult> {
  const out: LoadoutResult = {}
  const run = async (key: keyof LoadoutParts, fn: () => Promise<PartResult>): Promise<void> => {
    if (!input.parts[key]) return
    try {
      out[key] = await fn()
    } catch (err) {
      out[key] = { ok: false, message: err instanceof Error && err.message === 'Escrita não permitida' ? 'Operação não permitida.' : 'Não consegui falar com o cliente do LoL.' }
    }
  }
  await run('runes', () => importRunes(io, input))
  await run('spells', () => importSpells(io, input))
  await run('items', () => importItems(io, input))
  return out
}
