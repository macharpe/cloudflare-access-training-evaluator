import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CSPProvider } from '@cloudflare/kumo/primitives/csp-provider'
import App from './App'
import { readBootstrap } from './bootstrap'
import './styles.css'

const container = document.getElementById('root')
if (container) {
  // Base UI may render <style> elements (e.g. scrollbar handling in popups);
  // authorize them with the page's style nonce so the strict CSP keeps working.
  const nonce =
    document.querySelector<HTMLStyleElement>('style[nonce]')?.nonce || undefined
  createRoot(container).render(
    <StrictMode>
      <CSPProvider nonce={nonce}>
        <App bootstrap={readBootstrap()} />
      </CSPProvider>
    </StrictMode>,
  )
}
