#!/usr/bin/env bash
# Runs the three e2e scenarios used to verify v0.1 (see README).
set -u
cd "$(dirname "$0")/.."
GPU_ARGS="--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader"
echo "== 1) WASM (default headless Chrome has no WebGPU adapter)"
node scripts/e2e.mjs > artifacts/e2e-stdout.txt 2>&1; echo "exit=$?"
echo "== 2) WebGPU via SwiftShader (software GPU, very slow; checks the WebGPU code path)"
ART=artifacts/webgpu-swiftshader CHROME_ARGS="$GPU_ARGS" node scripts/e2e.mjs > artifacts/webgpu-swiftshader/e2e-stdout.txt 2>&1; echo "exit=$?"
echo "== 3) Forced failure: SAM on WebGPU (fails on SwiftShader) -> app must restart on WASM"
ART=artifacts/webgpu-fallback-test MODEL=modnet EXTRA_QS="&samDevice=webgpu" CHROME_ARGS="$GPU_ARGS" node scripts/e2e.mjs > artifacts/webgpu-fallback-test/e2e-stdout.txt 2>&1; echo "exit=$?"
