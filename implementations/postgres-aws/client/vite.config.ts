import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Docker Compose sets the server's service name: localhost in a container is the container itself.
const apiProxyTarget = process.env.API_PROXY_TARGET || 'http://localhost:3000';

// PDF.js's JBIG2 and JPEG 2000 decoders, without which scanned pages draw blank; fetched from one folder
// (`wasmUrl` in PdfPages.tsx).
const PDF_WASM_PATH = 'pdfjs-wasm/';
const pdfWasmDir = join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'wasm');
const pdfWasmFiles = [
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'qcms_bg.wasm',
];

function pdfWasm(): Plugin {
  return {
    name: 'pdfjs-wasm',
    configureServer(server) {
      server.middlewares.use(`/${PDF_WASM_PATH}`, (request, response, next) => {
        const name = request.url?.slice(1).split('?')[0] ?? '';
        if (!pdfWasmFiles.includes(name)) {
          next();
          return;
        }
        response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        createReadStream(join(pdfWasmDir, name)).pipe(response);
      });
    },
    generateBundle() {
      for (const name of pdfWasmFiles) {
        this.emitFile({ type: 'asset', fileName: `${PDF_WASM_PATH}${name}`, source: readFileSync(join(pdfWasmDir, name)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfWasm()],
  // Inline, so Vite doesn't search parent folders for one (blocked in the sandbox).
  css: { postcss: {} },
  server: {
    host: true, // bind 0.0.0.0 so the dev server is reachable from outside a container
    port: 5173,
    // Same-origin for the browser, so the session cookie needs no CORS.
    proxy: {
      '/api': apiProxyTarget,
      '/auth': apiProxyTarget,
    },
  },
});
