// Plano de jogo: a build do campeão reorganizada em início, meio e fim da partida.
// Só usa o que já está nos dados de meta (ordem de habilidades, itens iniciais, botas, itens principais e situacionais);
// não inventa dicas. É leitura: o app não joga nem decide nada pela pessoa.
import type { BuildSituation, ChampionBuild, SituationalItem, SkillKey } from './dataTypes'
import type { Role } from './types'

export interface PlanSkill {
  level: number
  key: SkillKey
}

export interface PlanPhase {
  id: 'early' | 'mid' | 'late'
  title: string
  /** faixa de níveis de campeão a que a fase se refere */
  levels: string
  /** habilidades a evoluir nesta fase (vazio se os dados não trazem a ordem por nível) */
  skills: PlanSkill[]
  /** itens a comprar nesta fase, na ordem */
  items: number[]
  /** itens situacionais (fase final) */
  situational: SituationalItem[]
  /** frases curtas tiradas dos dados */
  notes: string[]
  /** dicas gerais da rota para este momento (conhecimento geral do jogo, não vêm dos dados de meta) */
  tips: string[]
}

export interface GamePlan {
  phases: PlanPhase[]
  /** prioridade de habilidade sem a ultimate, ex.: ['Q','E','W'] */
  priority: SkillKey[]
  /** níveis em que a ultimate é evoluída (vazio se não há ordem por nível) */
  ultLevels: number[]
  /** feitiços de invocador mais usados */
  spells: [number, number] | null
}

type Moment = 'early' | 'mid' | 'late'

/** Dicas gerais por rota e momento da partida. São orientações de jogo, não números do meta. */
export const ROLE_TIPS: Record<Role, Record<Moment, string[]>> = {
  TOP: {
    early: ['Cuide da onda de minions: perto da sua torre quando a vida estiver baixa, empurre só se o selva puder ajudar.', 'Olhe o mapa: se o selva inimigo sumiu, jogue mais perto da torre.'],
    mid: ['Empurre a onda antes de sair da rota para não perder torre.', 'Chegue nas lutas de Dragão e Arauto com o feitiço de deslocamento pronto.'],
    late: ['Proteja-se de flancos: sua função costuma ser abrir a luta ou proteger o time, não entrar sozinho.', 'Se estiver atrás, jogue numa rota lateral e force o inimigo a se dividir.']
  },
  JUNGLE: {
    early: ['Planeje o clear para terminar perto da rota que tem prioridade; gank com a onda empurrada.', 'Anote o tempo de reaparecimento dos monstros e fique atento ao selva inimigo.'],
    mid: ['Priorize Dragão e Arauto com o time por perto e visão já colocada.', 'Gank a rota com a onda empurrada e o inimigo sem o feitiço de fuga.'],
    late: ['Monte controle de visão antes de ir ao Barão ou Ancião.', 'Evite andar sozinho: pegar um aliado isolado desmonta o time.']
  },
  MIDDLE: {
    early: ['Empurre a onda e use a prioridade da rota para ajudar o selva a chegar nos objetivos.', 'Recue antes do inimigo ganhar o nível 6: a ultimate dele muda a troca.'],
    mid: ['Depois de empurrar a onda, vá ajudar as rotas laterais e os objetivos.', 'Visão no rio protege o time dos flancos.'],
    late: ['Fique atrás da linha de frente e use as habilidades no alvo mais seguro de acertar.', 'Guarde a habilidade de fuga para a luta, não para a rota.']
  },
  BOTTOM: {
    early: ['Farm primeiro: cada minion perdido atrasa o item principal. Troque golpes quando o suporte puder ajudar.', 'Fique perto do suporte e não avance sem visão no mato.'],
    mid: ['Siga o time para torres e objetivos e fique atrás do tanque na luta.', 'Evite andar sozinho: você é alvo fácil para o selva inimigo.'],
    late: ['Você é o dano principal: ataque o alvo mais próximo e seguro, sem passar à frente da linha de frente.', 'Sobreviver à luta vale mais do que um abate arriscado.']
  },
  UTILITY: {
    early: ['Coloque visão em pontos que protejam a rota e troque o sentinela de tempos em tempos.', 'Proteja o atirador no farm e use as habilidades para ganhar as trocas.'],
    mid: ['Leve a visão para os objetivos antes do time chegar e remova a do inimigo.', 'Role com o time para Dragão e Arauto sem deixar o atirador sozinho.'],
    late: ['O controle de visão ao redor do Barão e do Dragão decide mais lutas do que qualquer item.', 'Guarde o escudo, a cura ou o controle de grupo para o momento certo da luta.']
  }
}

const SPLIT = { early: 5, mid: 11 } as const // fim do nível 5 e do nível 11

function skillsBetween(levels: SkillKey[] | undefined, from: number, to: number): PlanSkill[] {
  if (!levels) return []
  const out: PlanSkill[] = []
  for (let lv = from; lv <= to && lv <= levels.length; lv++) out.push({ level: lv, key: levels[lv - 1] })
  return out
}

/** Monta o plano; devolve null quando a build não tem nada para mostrar. */
export function buildGamePlan(build: ChampionBuild | null | undefined, situation?: BuildSituation | null, role?: Role | null): GamePlan | null {
  if (!build) return null
  const levels = build.skillOrder?.levels
  const priority = (build.skillOrder?.priority ?? []).filter((k) => k !== 'R')
  const core = situation?.variantCore && situation.variantCore.length > 0 ? situation.variantCore : build.items.core
  const ultLevels = levels ? levels.map((k, i) => (k === 'R' ? i + 1 : 0)).filter((n) => n > 0) : []

  const early: PlanPhase = {
    id: 'early',
    title: 'Início',
    levels: 'níveis 1 a 5',
    skills: skillsBetween(levels, 1, SPLIT.early),
    items: [...build.items.starting, ...build.items.boots],
    situational: [],
    notes: [],
    tips: role ? ROLE_TIPS[role].early : []
  }
  if (!levels && priority.length > 0) early.notes.push(`Evolua ${priority.join(' > ')} (prioridade).`)
  if (levels && priority.length > 0) early.notes.push(`Máximo primeiro: ${priority[0]}.`)

  const mid: PlanPhase = {
    id: 'mid',
    title: 'Meio',
    levels: 'níveis 6 a 11',
    skills: skillsBetween(levels, SPLIT.early + 1, SPLIT.mid),
    items: core.slice(0, 2),
    situational: [],
    notes: [],
    tips: role ? ROLE_TIPS[role].mid : []
  }
  if (ultLevels.length > 0) mid.notes.push(`Ultimate disponível no nível ${ultLevels[0]}.`)

  const late: PlanPhase = {
    id: 'late',
    title: 'Fim',
    levels: 'níveis 12 a 18',
    skills: skillsBetween(levels, SPLIT.mid + 1, 18),
    items: core.slice(2),
    situational: build.items.situational.slice(0, 4),
    notes: [],
    tips: role ? ROLE_TIPS[role].late : []
  }
  if (situation?.focus === 'armor') late.notes.push('O inimigo causa quase só dano físico: priorize armadura.')
  if (situation?.focus === 'magic-resist') late.notes.push('O inimigo causa quase só dano mágico: priorize resistência mágica.')
  if (situation?.focus === 'penetration') late.notes.push('O inimigo tem vários tanques: priorize penetração.')

  const empty = (p: PlanPhase): boolean => p.skills.length === 0 && p.items.length === 0 && p.situational.length === 0 && p.notes.length === 0
  const phases = [early, mid, late].filter((p) => !empty(p))
  if (phases.length === 0) return null
  return { phases, priority, ultLevels, spells: build.spells ?? null }
}
