// src/main/autoAccept.ts
// Aceita a partida encontrada ("ready check") quando o usuário liga a opção.
// Lógica separada da conexão para ser testável: recebe os estados e decide se/quando aceitar.
import type { ReadyCheck } from '../shared/types'

export interface AutoAcceptOptions {
  isEnabled: () => boolean
  /** espera antes de aceitar, em segundos */
  getDelaySec: () => number
  /** envia o aceite ao cliente; true = o cliente confirmou */
  accept: () => Promise<boolean>
  onAccepted: () => void
}

export class AutoAccept {
  private timer: NodeJS.Timeout | null = null
  /** já tratamos esta janela de "partida encontrada"? (o cliente manda vários eventos por janela) */
  private handled = false
  private current: ReadyCheck | null = null

  constructor(private readonly o: AutoAcceptOptions) {}

  /** Chame a cada evento de ready check (null = a janela fechou). */
  update(check: ReadyCheck | null): void {
    this.current = check
    const open = check?.state === 'InProgress'
    if (!open) {
      this.cancel()
      this.handled = false // próxima partida encontrada é uma janela nova
      return
    }
    if (check.playerResponse !== 'None') {
      this.cancel() // você (ou o app) já respondeu
      this.handled = true
      return
    }
    if (this.handled || !this.o.isEnabled()) return
    this.handled = true
    const delay = Math.max(0, Math.min(8, this.o.getDelaySec())) * 1000
    this.timer = setTimeout(() => void this.fire(), delay)
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
    this.cancel()
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async fire(): Promise<void> {
    this.timer = null
    // Reconfere na hora: a pessoa pode ter desligado, aceitado à mão ou a janela pode ter fechado (recusa/dodge).
    const c = this.current
    if (!this.o.isEnabled() || !c || c.state !== 'InProgress' || c.playerResponse !== 'None') return
    try {
      if (await this.o.accept()) this.o.onAccepted()
    } catch {
      /* cliente fechou no meio: a próxima janela tenta de novo */
    }
  }
}
