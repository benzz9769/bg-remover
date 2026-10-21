// Copies runtime assets from node_modules into public/ so the app is fully
// self-hosted (no CDN needed for the ONNX Runtime WASM binary).
import { cpSync, mkdirSync } from 'node:fs';
const ort = 'node_modules/onnxruntime-web/dist';
mkdirSync('public/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  cpSync(`${ort}/${f}`, `public/ort/${f}`);
}
cpSync('node_modules/coi-serviceworker/coi-serviceworker.min.js', 'public/coi-serviceworker.js');
console.log('assets copied to public/');
