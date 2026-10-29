// tools/meta/riot.ts
// Cliente mínimo da Riot API: respeita o limite de requisições, repete em 429/5xx
// e nunca imprime a chave. Chave de desenvolvimento = 20 req/s e 100 req/2 min.

/** Chave inválida, expirada (as de desenvolvimento duram 24 h) ou sem permissão. */
export class RiotAuthError extends Error {
  constructor(status: number) {
    super(
      `A Riot recusou a chave (HTTP ${status}). Chaves de desenvolvimento expiram a cada 24 h: gere outra em developer.riotgames.com.`
    )
    this.name = 'RiotAuthError'
  }
}

/** Host de roteamento regional do Match-v5 para cada plataforma. */
export const REGION_OF_PLATFORM: Record<string, string> = {
  br1: 'americas', na1: 'americas', la1: 'americas', la2: 'americas',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea'
}

export interface RiotClientOptions {
  apiKey: string
  platformBase: string
  regionalBase: string
  /** requisições por segundo (0,8 cabe no limite de 100 por 2 min da chave de desenvolvimento) */
  rps: number
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxRetries?: number
  log?: (message: string) => void
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class RiotClient {
  private nextSlot = 0
  private readonly fetchFn: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRetries: number
  private readonly log: (message: string) => void

  constructor(private readonly o: RiotClientOptions) {
    if (!(o.rps > 0)) throw new Error('rps precisa ser maior que zero')
    this.fetchFn = o.fetchFn ?? fetch
    this.sleep = o.sleep ?? defaultSleep
    this.maxRetries = o.maxRetries ?? 6
    this.log = o.log ?? (() => undefined)
  }

  /** Espaça as chamadas: cada uma ocupa um intervalo de 1/rps segundos. */
  private async throttle(): Promise<void> {
    const now = Date.now()
    const start = Math.max(now, this.nextSlot)
    this.nextSlot = start + 1000 / this.o.rps
    if (start > now) await this.sleep(start - now)
  }

  /** null = 404 (não existe). Lança em erros definitivos. */
  async get<T>(kind: 'platform' | 'regional', path: string, query?: Record<string, string | number>): Promise<T | null> {
    const url = new URL(path, kind === 'platform' ? this.o.platformBase : this.o.regionalBase)
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v))

    for (let attempt = 0; ; attempt++) {
      await this.throttle()
      let res: Response
      try {
        res = await this.fetchFn(url, { headers: { 'X-Riot-Token': this.o.apiKey }, signal: AbortSignal.timeout(20_000) })
      } catch {
        if (attempt >= this.maxRetries) throw new Error(`Sem resposta da Riot em ${path}`)
        await this.sleep(2000 * (attempt + 1))
        continue
      }

      if (res.status === 200) return (await res.json()) as T
      if (res.status === 404) return null
      if (res.status === 401 || res.status === 403) throw new RiotAuthError(res.status)
      if (res.status === 429) {
        if (attempt >= this.maxRetries) throw new Error('A Riot continua limitando as requisições. Tente de novo mais tarde.')
        const wait = Number(res.headers.get('retry-after')) || 10
        this.log(`Limite de requisições atingido; aguardando ${wait}s`)
        await this.sleep(wait * 1000)
        continue
      }
      if (res.status >= 500 && attempt < this.maxRetries) {
        await this.sleep(2000 * (attempt + 1))
        continue
      }
      throw new Error(`A Riot respondeu ${res.status} em ${path}`)
    }
  }
}
