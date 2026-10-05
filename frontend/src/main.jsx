import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
// Initialises i18next (English / Filipino / Cebuano) before React renders.
import './i18n'
import { queryClient } from './api/queries.js'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { OfflineQueueProvider } from './context/OfflineQueueContext.jsx'
import AppRoutes from './routes/index.jsx'

// Installable PWA: register the app-shell service worker. Production only —
// in dev the Vite server owns module loading and a service worker would serve
// stale bundles over HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A failed registration must never break the app.
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Theme above Toast: a flip restyles live toasts in the same tick. */}
      <ThemeProvider>
        <ToastProvider>
          {/* Flushes queued offline submissions on reconnect, app-wide. */}
          <OfflineQueueProvider>
            <AppRoutes />
          </OfflineQueueProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
