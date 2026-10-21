export type Device = 'webgpu' | 'wasm';
export type AutoModelId = 'birefnet-lite' | 'modnet';

export interface ModelInfo {
  id: AutoModelId;
  repo: string;
  /** Pinned Hugging Face commit so the app does not change under users. */
  revision: string;
  license: string;
}

export const AUTO_MODELS: Record<AutoModelId, ModelInfo> = {
  // 512x512 re-export of ZhengPeng7/BiRefNet_lite. The official 1024x1024
  // onnx-community export hits std::bad_alloc in onnxruntime-web (verified
  // on WASM in this project's e2e run), so we use the 512 export.
  'birefnet-lite': {
    id: 'birefnet-lite',
    repo: 'studioludens/birefnet-lite-512',
    revision: '962e67969ec6acec9c19fab76acee4f5e22e990c',
    license: 'MIT',
  },
  modnet: {
    id: 'modnet',
    repo: 'Xenova/modnet',
    revision: 'fa2fa546052fba4c08921230a26cc69a333fca12',
    license: 'Apache-2.0',
  },
};
export const SAM_MODEL = {
  repo: 'Xenova/slimsam-77-uniform',
  revision: '5850ab45f587c112167512ffef949107115e26a0',
  license: 'Apache-2.0',
};

export interface ImagePayload {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export type ToWorker =
  | { type: 'init'; device?: Device | 'auto'; samDevice?: Device }
  | { type: 'setImage'; id: number; image: ImagePayload; autoModel: AutoModelId }
  | { type: 'segmentPoint'; id: number; points: { x: number; y: number; label: 0 | 1 }[] };

export type FromWorker =
  | { type: 'ready'; device: Device; crossOriginIsolated: boolean; threads: number }
  | { type: 'progress'; stage: 'auto' | 'sam'; file: string; loaded: number; total: number; status: string }
  | { type: 'status'; id?: number; stage: string; message?: string }
  | { type: 'autoMask'; id: number; width: number; height: number; mask: Uint8Array; ms: number; loadMs: number }
  | { type: 'samReady'; id: number; ms: number; loadMs: number }
  | {
      type: 'pointMask';
      id: number;
      width: number;
      height: number;
      /** SAM's 3 multimask candidates, sorted from smallest to largest area. */
      masks: Uint8Array[];
      scores: number[];
      ms: number;
    }
  | { type: 'error'; id?: number; stage: string; message: string };
