import { defineConfig, type Plugin } from 'vite';

// COOP/COEP headers enable SharedArrayBuffer -> multi-threaded WASM.
// (Static hosts that cannot set headers use public/coi-serviceworker.js instead.)
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// onnxruntime-web references its own WASM via import.meta.url as a fallback.
// We always set wasmPaths to the copy in public/ort/, so drop the duplicate
// (~27 MB) that Vite would otherwise emit into assets/.
const dropDuplicateOrtWasm = (): Plugin => ({
  name: 'drop-duplicate-ort-wasm',
  apply: 'build',
  generateBundle(_opts, bundle) {
    for (const k of Object.keys(bundle)) if (/assets\/ort-wasm.*\.wasm$/.test(k)) delete bundle[k];
  },
});

export default defineConfig({
  plugins: [dropDuplicateOrtWasm()],
  // GitHub Pages project site. Absolute base so the service worker, ONNX
  // Runtime wasm files, and the module worker all resolve under /bg-remover/
  // (a relative "./" base is resolved against the worker origin and misses
  // the repo subpath).
  base: '/bg-remover/',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  server: { headers: isolation },
  preview: { headers: isolation },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
