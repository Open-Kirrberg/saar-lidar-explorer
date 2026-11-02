/** Message protocol between the main thread and decode.worker.ts. */

export type DecodeKind = 'terrarium' | 'u8';

export type WorkerRequest =
  | { type: 'decode'; id: number; url: string; kind: DecodeKind }
  | {
      type: 'boxblur';
      id: number;
      data: Float32Array;
      width: number;
      height: number;
      radius: number;
      /** Optional window of the result to return (x, y, w, h) instead of the whole raster. */
      crop?: [number, number, number, number];
    };

export type WorkerResponse =
  | { type: 'decoded'; id: number; kind: 'terrarium'; width: number; height: number; data: Float32Array }
  | { type: 'decoded'; id: number; kind: 'u8'; width: number; height: number; data: Uint8Array }
  | { type: 'blurred'; id: number; data: Float32Array }
  | { type: 'error'; id: number; message: string };
