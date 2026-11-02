// src/main/autoAccept.ts
// Aceita a partida encontrada ("ready check") quando o usuário liga a opção.
// Lógica separada da conexão para ser testável: recebe os estados e decide se/quando aceitar.
import type { ReadyCheck } from '../shared/types'

export interface AutoAcceptOptions {
  isEnabled: () => boolean
  /** espera antes de aceitar, em segundos */
  getDelaySec: () => number
  /** envia o aceite ao cliente; ok = o cliente confirmou (2xx) */
  accept: () => Promise<{ ok: boolean; status: number }>
  onAccepted: () => void
  /** cada tentativa (para diagnóstico) */
  onAttempt?: (info: { attempt: number; ok: boolean; status: number }) => void
  /** tentativas por janela e espera entre elas */
  maxAttempts?: number
  retryMs?: number
}

export class AutoAccept {
  private timer: NodeJS.Timeout | null = null
  /** já tratamos esta janela de "partida encontrada"? (o cliente manda vários eventos por janela) */
  private handled = false
  private current: ReadyCheck | null = null
  /** o cliente já mostrou uma resposta (Accepted/Declined) nesta janela */
  private sawResponse = false
  private stopped = false

  constructor(private readonly o: AutoAcceptOptions) {}

  /** Chame a cada evento de ready check (null = a janela fechou). */
  update(check: ReadyCheck | null): void {
    this.current = check
    const open = check?.state === 'InProgress'
    if (!open) {
      this.cancel()
      this.handled = false // próxima partida encontrada é uma janela nova
      this.sawResponse = false
      return
    }
    if (check.playerResponse !== 'None') {
      this.cancel() // você (ou o app) já respondeu
      this.handled = true
      this.sawResponse = true
      return
    }
    // Janela aberta SEM resposta depois de uma janela respondida: é uma partida nova. Acontece quando outro jogador
    // não aceita e o cliente devolve você à fila sem avisar que a janela anterior fechou.
    if (this.sawResponse) {
      this.sawResponse = false
      this.handled = false
    }
    if (this.handled || !this.o.isEnabled()) return
    this.handled = true
    const delay = Math.max(0, Math.min(8, this.o.getDelaySec())) * 1000
    this.timer = setTimeout(() => void this.fire(), delay)
  }

  /** O cliente saiu da fase "partida encontrada" (fila, seleção…): qualquer janela nova começa do zero. */
  reset(): void {
    this.cancel()
    this.handled = false
    this.sawResponse = false
    this.current = null
  }

  /** Ligou a opção com a janela já aberta: aceita também. */
  enabledChanged(): void {
    if (this.o.isEnabled() && this.current) this.update(this.current)
    else if (!this.o.isEnabled()) {
      this.cancel()
      this.handled = false
    }
  }

  stop(): void {
    this.stopped = true
    this.cancel()
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async fire(): Promise<void> {
    this.timer = null
    const max = this.o.maxAttempts ?? 4
    const retryMs = this.o.retryMs ?? 700
    for (let attempt = 1; attempt <= max; attempt++) {
      // Reconfere na hora: a pessoa pode ter desligado, aceitado à mão ou a janela pode ter fechado (recusa/dodge).
      const c = this.current
      if (!this.o.isEnabled() || !c || c.state !== 'InProgress' || c.playerResponse !== 'None') return
      try {
        const res = await this.o.accept()
        this.o.onAttempt?.({ attempt, ok: res.ok, status: res.status })
        if (res.ok) {
          this.o.onAccepted()
          return
        }
      } catch {
        this.o.onAttempt?.({ attempt, ok: false, status: 0 })
      }
      if (attempt < max) await new Promise<void>((r) => setTimeout(r, retryMs))
      if (this.stopped) return
    }
  }
}
