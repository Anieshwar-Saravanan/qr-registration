import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Camera access needs a secure context: browsers expose getUserMedia only on
// https:// or localhost. Testing the scanner on a phone means hitting this dev
// server over the LAN, which is neither - so `npm run dev:https` serves it over
// TLS with a self-signed certificate. You tap through one browser warning per
// device, and the camera then works.
const useHttps = process.env.HTTPS === '1'

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    port: 5173,
    // Vite rejects requests whose Host header it does not recognise, which
    // would block a tunnel URL. Only needed when tunnelling for phone testing.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'],
    // Proxying /api to FastAPI keeps the browser on one origin in dev, so
    // there are no CORS preflights to debug while building.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
