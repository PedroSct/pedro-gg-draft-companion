// src/main/data/matchupBuild.ts
// Ajusta a build ao oponente de rota da partida: troca as runas e os feitiços padrão pelos mais usados contra ele,
// quando existe amostra e a escolha é diferente da geral. Função pura.
import type { BuildOption, ChampionBuild, MatchupBuild, RunePage } from '../../shared/dataTypes'

const sameRunes = (a: RunePage, b: RunePage): boolean =>
  a.primaryStyleId === b.primaryStyleId && a.subStyleId === b.subStyleId && a.perkIds.length === b.perkIds.length && a.perkIds.every((p, i) => p === b.perkIds[i])
const sameSpells = (a: readonly number[], b: readonly number[]): boolean => [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join()

/** A opção do confronto vai para o começo da lista (a posição 0 é o padrão que o app importa). */
function front<T>(list: BuildOption<T>[] | undefined, pick: BuildOption<T>, same: (a: T, b: T) => boolean): BuildOption<T>[] {
  return [pick, ...(list ?? []).filter((o) => !same(o.value, pick.value))].slice(0, 4)
}

export function withMatchupBuild(base: ChampionBuild, mb: MatchupBuild | undefined, enemyId: number): ChampionBuild {
  if (!mb) return base
  const out: ChampionBuild = { ...base }
  let runesChanged = false
  let spellsChanged = false
  const options = base.options ? { ...base.options } : undefined

  if (mb.runes) {
    runesChanged = !base.runes || !sameRunes(base.runes, mb.runes.value)
    if (runesChanged) {
      out.runes = mb.runes.value
      if (options) options.runes = front(options.runes, mb.runes, sameRunes)
    }
  }
  if (mb.spells) {
    spellsChanged = !base.spells || !sameSpells(base.spells, mb.spells.value)
    if (spellsChanged) {
      out.spells = mb.spells.value
      if (options) options.spells = front(options.spells, mb.spells, sameSpells)
    }
  }
  if (options) out.options = options
  out.matchup = { enemyId, games: mb.games, runes: runesChanged, spells: spellsChanged }
  return out
}
