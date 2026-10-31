import type { Role } from '../../../shared/types'

export const ROLE_LABEL: Record<Role, string> = {
  TOP: 'Topo',
  JUNGLE: 'Selva',
  MIDDLE: 'Meio',
  BOTTOM: 'Atirador',
  UTILITY: 'Suporte'
}

export const ROLE_SHORT: Record<Role, string> = {
  TOP: 'Top',
  JUNGLE: 'Selva',
  MIDDLE: 'Mid',
  BOTTOM: 'ADC',
  UTILITY: 'Sup'
}

const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signedNum = new Intl.NumberFormat('pt-BR', { signDisplay: 'exceptZero', minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** 0.523 → "52,3%" */
export const pct = (x: number): string => percent.format(x)
/** 1.234 → "+1,2" */
export const signed = (x: number): string => signedNum.format(x)

/** Para busca: "Kai'Sa" e "kaisa" se encontram; acentos não atrapalham. */
export const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()

/** Arte do campeão (já recortada para cartões). Só é pedida quando o cartão aparece. */
export const splashUrl = (championKey: string): string =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/centered/${encodeURIComponent(championKey)}_0.jpg`
