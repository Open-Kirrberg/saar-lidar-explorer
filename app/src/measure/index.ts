/**
 * F17 Messen: wiring entry point (one call from ui/features.ts).
 */
import type { AppContext } from '../main';
import type { Labels3D } from '../ui/Labels3D';
import { MeasureTool } from './MeasureTool';
import type { ExclusiveMode } from './MeasureTool';

export { MeasureTool };

declare global {
  interface Window {
    /** Debug/verification handle for the measuring tool. */
    sleMeasure?: MeasureTool;
  }
}

export function initMeasure(
  ctx: AppContext,
  panel: HTMLElement,
  labels: Labels3D,
  opts: { toolbar?: HTMLElement; exclusiveWith?: ExclusiveMode } = {},
): MeasureTool {
  const tool = new MeasureTool(ctx, panel, labels);
  if (opts.toolbar) tool.attachToolbar(opts.toolbar);
  if (opts.exclusiveWith) tool.exclusiveWith(opts.exclusiveWith);
  window.sleMeasure = tool;
  return tool;
}
