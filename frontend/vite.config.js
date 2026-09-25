import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Dev server port. To move it, set VITE_DEV_PORT in frontend/.env (see
  // .env.example) — or use `vite --port 5174` for a one-off run.
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.VITE_DEV_PORT) || 5173

  // Tunnel mode — `npm run dev:ngrok` with frontend/.env.ngrok. The dev server
  // is then reached through a public host instead of localhost, which changes
  // three things: Vite has to accept that Host header, API calls have to stay
  // same-origin so the Sanctum session cookie is still first-party, and the HMR
  // socket has to come back over the tunnel's TLS endpoint. All of it is inert
  // unless VITE_TUNNEL_HOST is set, so plain `npm run dev` is unaffected.
  const tunnelHost = env.VITE_TUNNEL_HOST?.trim()
  const apiTarget = env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:8005'

  return {
    plugins: [react(), tailwindcss()],

    // maplibre-gl resolves its web worker as a sibling file
    // (dist/maplibre-gl-worker.mjs). The dep optimizer rewrites that URL
    // into node_modules/.vite/deps/ but never emits the worker there, so
    // the browser 404s and MapLibre fails to start. Excluding the package
    // keeps dev serving it from source — it is ESM, so that is fine — and
    // the worker URL stays intact. Production (rollup) is unaffected.
    optimizeDeps: {
      exclude: ['maplibre-gl'],
    },

    server: {
      port,
      // Fail loudly instead of hopping to another port — Sanctum cookie auth
      // only works from an origin the backend trusts, so a silent port change
      // would surface as a confusing 419 or CORS error on login. If you do
      // change the port, update backend/.env to match and restart the API:
      //   SANCTUM_STATEFUL_DOMAINS=localhost:<port>,127.0.0.1:<port>
      //   CORS_ALLOWED_ORIGINS=http://localhost:<port>,http://127.0.0.1:<port>
      strictPort: true,

      // Tunnel mode only (see VITE_TUNNEL_HOST above). Vite 6+ rejects requests
      // whose Host header it does not recognise, and the SPA has to reach the
      // API on the tunnel origin so csrf-cookie/session cookies stay
      // first-party — pair this with VITE_API_URL= in frontend/.env.ngrok and
      // the tunnel host in backend/.env SANCTUM_STATEFUL_DOMAINS.
      ...(tunnelHost
        ? {
            allowedHosts: [
              tunnelHost,
              '.ngrok-free.app',
              '.ngrok-free.dev',
              '.trycloudflare.com',
            ],

            proxy: {
              '/api': { target: apiTarget, changeOrigin: false },
              '/sanctum': { target: apiTarget, changeOrigin: false },
            },

            // HMR reconnects through the tunnel's TLS endpoint.
            hmr: { protocol: 'wss', clientPort: 443 },
          }
        : {}),
    },
  }
})
