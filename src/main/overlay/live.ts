// src/main/overlay/live.ts
// Leitura da Live Client Data API da Riot (https://127.0.0.1:2999), a interface oficial para apps lerem a partida em
// andamento. Só leitura, só no próprio PC, e só o que o jogador já vê na tela dele.
import https from 'node:https'
import { ROLES } from '../../shared/dataTypes'
import type { LiveSnapshot } from '../../shared/overlay'
import type { Role } from '../../shared/types'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Só o Summoner's Rift (clássico e Ferramenta de Treino) tem build: ARAM, Arena etc. ficam de fora. */
export function isSummonersRift(raw: unknown): boolean {
  if (!isRecord(raw) || !isRecord(raw.gameData)) return false
  return raw.gameData.mapNumber === 11 && (raw.gameData.gameMode === 'CLASSIC' || raw.gameData.gameMode === 'PRACTICETOOL')
}

/** Transforma a resposta de /liveclientdata/allgamedata no retrato usado pelo painel; null se faltar o essencial. */
export function parseLive(raw: unknown): LiveSnapshot | null {
  if (!isRecord(raw) || !isSummonersRift(raw)) return null
  const active = raw.activePlayer
  const all = raw.allPlayers
  if (!isRecord(active) || !Array.isArray(all)) return null

  const myId = typeof active.riotId === 'string' ? active.riotId : typeof active.summonerName === 'string' ? active.summonerName : ''
  const me = all.find(
    (p) => isRecord(p) && myId !== '' && (p.riotId === myId || p.summonerName === myId || p.riotIdGameName === myId)
  )
  if (!isRecord(me)) return null

  const abilities = isRecord(active.abilities) ? active.abilities : {}
  const lvl = (k: string): number => {
    const a = abilities[k]
    return isRecord(a) ? num(a.abilityLevel) : 0
  }
  const items = (Array.isArray(me.items) ? me.items : [])
    .map((i) => (isRecord(i) ? num(i.itemID) : 0))
    .filter((id) => id > 0)

  const rawName = typeof me.rawChampionName === 'string' ? me.rawChampionName : ''
  const key = rawName.replace(/^game_character_displayname_/i, '')
  const position = typeof me.position === 'string' ? me.position.toUpperCase() : ''
  const role = (ROLES as readonly string[]).includes(position) ? (position as Role) : null

  return {
    gameTime: isRecord(raw.gameData) ? num(raw.gameData.gameTime) : 0,
    level: Math.max(1, num(active.level, 1)),
    abilities: { Q: lvl('Q'), W: lvl('W'), E: lvl('E'), R: lvl('R') },
    gold: typeof active.currentGold === 'number' && Number.isFinite(active.currentGold) ? Math.floor(active.currentGold) : undefined,
    items,
    championKey: key && key !== rawName ? key : null,
    championName: typeof me.championName === 'string' ? me.championName : key,
    role
  }
}

// A Live Client Data API usa um certificado próprio do jogo: só aqui se aceita, e só para 127.0.0.1:2999.
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false })

/** Busca os dados da partida; null quando não há jogo em andamento (conexão recusada) ou algo deu errado. */
export function fetchLive(timeoutMs = 1500): Promise<unknown | null> {
  return new Promise((resolve) => {
    const req = https.request(
      { host: '127.0.0.1', port: 2999, path: '/liveclientdata/allgamedata', method: 'GET', agent, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return resolve(null)
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => {
          body += c
          if (body.length > 4_000_000) req.destroy()
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(body))
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end()
  })
}
