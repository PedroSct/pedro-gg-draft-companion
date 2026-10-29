/// <reference types="vite/client" />
import type { LolApi } from '../../shared/api'

declare global {
  interface Window {
    api: LolApi
  }
}

export {}
