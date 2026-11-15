// Servidores do meta (códigos da Riot) e os nomes mostrados no app.
export const DEFAULT_REGIONS = ['br1', 'na1', 'la1', 'la2', 'euw1', 'eun1', 'tr1', 'kr', 'jp1', 'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2']
export const REGION_NAMES: Record<string, string> = {
  br1: 'Brasil (BR)',
  na1: 'América do Norte (NA)',
  la1: 'América Latina Norte (LAN)',
  la2: 'América Latina Sul (LAS)',
  euw1: 'Europa Oeste (EUW)',
  eun1: 'Europa Nordeste (EUNE)',
  tr1: 'Turquia (TR)',
  ru: 'Rússia (RU)',
  kr: 'Coreia (KR)',
  jp1: 'Japão (JP)',
  oc1: 'Oceania (OCE)',
  ph2: 'Filipinas (PH)',
  sg2: 'Singapura (SG)',
  th2: 'Tailândia (TH)',
  tw2: 'Taiwan (TW)',
  vn2: 'Vietnã (VN)'
}


/** Sigla curta: BR, NA, EUW... */
export const regionShort = (code: string): string => /\(([^)]+)\)/.exec(REGION_NAMES[code] ?? '')?.[1] ?? code.toUpperCase()
