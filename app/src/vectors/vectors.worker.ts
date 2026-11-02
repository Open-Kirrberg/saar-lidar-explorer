/** Off-main-thread GeoJSON fetch + parse + bucketing for draped vector layers (see vectorData.ts). */
import { fetchText, handleVectorRequest } from './vectorData';
import type { VectorRequest, VectorResponse } from './vectorData';

interface WorkerScope {
  onmessage: ((ev: MessageEvent<VectorRequest>) => void) | null;
  postMessage(msg: VectorResponse, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (ev) => {
  void handleVectorRequest(ev.data, fetchText).then(({ res, transfer }) => scope.postMessage(res, transfer));
};
