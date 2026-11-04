import type { KairoApi } from '../../shared/api'

declare global {
  interface Window {
    kairo: KairoApi
  }
}

export {}
