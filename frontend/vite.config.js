import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fail loudly instead of hopping to another port — the backend's
    // CORS/Sanctum config only allows http://localhost:5173.
    strictPort: true,
  },
})
