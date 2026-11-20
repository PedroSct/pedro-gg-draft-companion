import type { Tier } from '../../../shared/dataTypes'

export const TIER_STYLE: Record<Tier, string> = {
  S: 'text-gold border-gold/40',
  A: 'text-good border-good/40',
  B: 'text-ally border-ally/40',
  C: 'text-mist border-line',
  D: 'text-enemy border-enemy/40'
}

export function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border font-display text-sm font-bold ${TIER_STYLE[tier]}`}>{tier}</span>
}
