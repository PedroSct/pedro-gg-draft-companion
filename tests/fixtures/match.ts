// Partida de mentira no formato que o cliente do LoL devolve (game, timeline e placar final).
// Participante 1 = "Pedro" (Topo, time azul 100). Participante 6 = oponente de topo (time vermelho 200).
const LANES: [string, string][] = [
  ['TOP', 'SOLO'],
  ['JUNGLE', 'NONE'],
  ['MIDDLE', 'SOLO'],
  ['BOTTOM', 'DUO_CARRY'],
  ['BOTTOM', 'DUO_SUPPORT']
]
const CHAMPS = [266, 64, 103, 22, 412, 54, 11, 7, 51, 111] // Aatrox, LeeSin, Ahri, Ashe, Thresh, Malphite, MasterYi, Leblanc, Caitlyn, Nautilus

export interface FixtureOpts {
  /** CS por minuto do jogador 1 (oponente faz 7) */
  myCsPerMin?: number
  myDeaths?: number
  durationMin?: number
  /** participante que é "você" (1 = topo azul; 5 = suporte azul) */
  me?: number
  /** simula um cliente que não informa as rotas (lane/role = NONE) */
  hideRoles?: boolean
}

export function makeLcuMatch(o: FixtureOpts = {}) {
  const dur = o.durationMin ?? 25
  const myIdx = o.me ?? 1
  const POS: [number, number][] = [[2400, 12400], [9500, 5500], [7400, 7400], [12400, 2400], [12000, 2900]]
  const myCpm = o.myCsPerMin ?? 7.5
  const participants: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  const identities: any[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 1; i <= 10; i++) {
    const [lane, role] = LANES[(i - 1) % 5]
    const me = i === myIdx
    participants.push({
      participantId: i,
      teamId: i <= 5 ? 100 : 200,
      championId: CHAMPS[i - 1],
      stats: {
        kills: me ? 5 : 3,
        deaths: me ? (o.myDeaths ?? 2) : 4,
        assists: me ? 7 : 5,
        totalMinionsKilled: Math.round((me ? myCpm : 7) * dur * (lane === 'JUNGLE' ? 0.2 : lane === 'BOTTOM' && role === 'DUO_SUPPORT' ? 0.15 : 1)),
        neutralMinionsKilled: lane === 'JUNGLE' ? Math.round(5 * dur) : 4,
        goldEarned: me ? 13500 : 11800,
        totalDamageDealtToChampions: me ? 24000 : 17000,
        visionScore: me ? 22 : 30,
        wardsPlaced: me ? 8 : 12,
        wardsKilled: 2,
        win: i <= 5
      },
      timeline: o.hideRoles ? { lane: 'NONE', role: 'NONE' } : { lane, role },
      spell1Id: lane === 'JUNGLE' ? 11 : 4,
      spell2Id: lane === 'JUNGLE' ? 4 : 14
    })
    identities.push({
      participantId: i,
      player: { summonerName: i === myIdx ? 'Pedro' : `Jogador${i}`, gameName: i === myIdx ? 'Pedro' : `Jogador${i}`, tagLine: 'BR1', puuid: i === myIdx ? 'puuid-pedro' : `puuid-${i}`, summonerId: i === myIdx ? 111 : 200 + i, currentAccountId: i === myIdx ? 999 : 300 + i }
    })
  }
  const game = {
    gameId: 7000000001,
    gameCreation: 1_761_700_000_000,
    gameDuration: dur * 60,
    queueId: 420,
    gameMode: 'CLASSIC',
    participants,
    participantIdentities: identities,
    teams: [
      { teamId: 100, win: 'Win' },
      { teamId: 200, win: 'Fail' }
    ]
  }

  const frames = []
  for (let m = 0; m <= dur; m++) {
    const pf: Record<string, unknown> = {}
    for (let i = 1; i <= 10; i++) {
      const me = i === myIdx
      const jg = (i - 1) % 5 === 1
      const cpm = me ? myCpm : i === ((myIdx + 4) % 10) + 1 ? 7 : 6.5
      pf[String(i)] = {
        participantId: i,
        level: Math.min(18, 1 + Math.floor(m * 0.7)),
        xp: Math.round(m * (me ? 560 : 520)),
        minionsKilled: jg ? Math.round(m * 0.8) : Math.round(m * cpm),
        jungleMinionsKilled: jg ? Math.round(m * 5) : 0,
        totalGold: 500 + Math.round(m * (me ? 520 : 480)),
        currentGold: 100,
        position: { x: POS[(i - 1) % 5][0] + (m % 3) * 40, y: POS[(i - 1) % 5][1] - (m % 4) * 30 }
      }
    }
    const events: unknown[] = []
    if (m === 4) events.push({ type: 'CHAMPION_KILL', timestamp: 4 * 60000 + 3000, killerId: 1, victimId: 6, assistingParticipantIds: [2] })
    if (m === 8) events.push({ type: 'CHAMPION_KILL', timestamp: 8 * 60000 + 2000, killerId: 7, victimId: 1, assistingParticipantIds: [] })
    if (m === 7) events.push({ type: 'ELITE_MONSTER_KILL', timestamp: 7 * 60000, monsterType: 'DRAGON', monsterSubType: 'FIRE_DRAGON', killerId: 2, killerTeamId: 100, assistingParticipantIds: [1, 3] })
    if (m === 12) events.push({ type: 'BUILDING_KILL', timestamp: 12 * 60000, buildingType: 'TOWER_BUILDING', towerType: 'OUTER_TURRET', teamId: 200, killerId: 1, assistingParticipantIds: [] })
    if (m === 20) events.push({ type: 'ELITE_MONSTER_KILL', timestamp: 20 * 60000, monsterType: 'BARON_NASHOR', killerId: 3, killerTeamId: 100, assistingParticipantIds: [1, 2, 4, 5] })
    if (m === 21) events.push({ type: 'CHAMPION_KILL', timestamp: 21 * 60000, killerId: 8, victimId: 3, assistingParticipantIds: [7] })
    frames.push({ timestamp: m * 60000, participantFrames: pf, events })
  }
  const timeline = { frameInterval: 60000, frames }

  const eog = {
    gameId: game.gameId,
    gameLength: dur * 60,
    gameMode: 'CLASSIC',
    localPlayer: { championId: CHAMPS[myIdx - 1], teamId: 100, summonerName: 'Pedro' },
    teams: [100, 200].map((teamId) => ({
      teamId,
      isWinningTeam: teamId === 100,
      players: participants
        .filter((p) => p.teamId === teamId)
        .map((p) => ({
          championId: p.championId,
          summonerName: identities[p.participantId - 1].player.summonerName,
          stats: {
            CHAMPIONS_KILLED: p.stats.kills,
            NUM_DEATHS: p.stats.deaths,
            ASSISTS: p.stats.assists,
            MINIONS_KILLED: p.stats.totalMinionsKilled,
            NEUTRAL_MINIONS_KILLED: p.stats.neutralMinionsKilled,
            GOLD_EARNED: p.stats.goldEarned,
            TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: p.stats.totalDamageDealtToChampions,
            VISION_SCORE: p.stats.visionScore
          }
        }))
    }))
  }
  return { game, timeline, eog, me: { puuid: 'puuid-pedro', summonerId: 111, name: 'Pedro' } }
}
