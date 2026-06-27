import type { PluriApi } from './index'

declare global {
  interface Window {
    api: PluriApi
  }
}

export {}
