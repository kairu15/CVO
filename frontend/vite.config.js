import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Dev server port. To move it, set VITE_DEV_PORT in frontend/.env (see
  // .env.example) — or use `vite --port 5174` for a one-off run.
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.VITE_DEV_PORT) || 5173

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port,
      // Fail loudly instead of hopping to another port — Sanctum cookie auth
      // only works from an origin the backend trusts, so a silent port change
      // would surface as a confusing 419 or CORS error on login. If you do
      // change the port, update backend/.env to match and restart the API:
      //   SANCTUM_STATEFUL_DOMAINS=localhost:<port>,127.0.0.1:<port>
      //   CORS_ALLOWED_ORIGINS=http://localhost:<port>,http://127.0.0.1:<port>
      strictPort: true,
    },
  }
})
