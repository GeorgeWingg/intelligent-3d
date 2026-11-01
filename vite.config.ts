import { defineConfig } from 'vite';
// Dev: Vite on 5320 proxies /api to the Node server on 4320. Prod: the Node server serves dist/.
export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:4320' } },
  build: { target: 'esnext' },
});
