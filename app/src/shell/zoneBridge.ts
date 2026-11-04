/**
 * Pure glue between the shell and the zone runtime (`src/zones/`, contract sle-zone-v1, ADR 0029):
 * pose conversion (store ⇄ contract `Pose`), move modes, zone source rows for „© Quellen“
 * (ADR 0026 rule 6) and the loading-screen text. No DOM.
 */
import type { MoveMode as ZoneMoveMode, Pose, ZoneManifest } from '../zones/contract';
import { rowFromEntry } from './attribution';
import type { SourceRow } from './attribution';
import type { MoveMode } from './flight';

export const toZoneMode = (m: MoveMode): ZoneMoveMode => (m === 'walk' ? 'gehen' : 'fliegen');
export const fromZoneMode = (m: ZoneMoveMode): MoveMode => (m === 'gehen' ? 'walk' : 'fly');

/** Store view (true height, grid heading, pitch) + shell move mode → contract pose. */
export function poseFromView(v: { E: number; N: number; h: number; heading: number; pitch: number }, mode: MoveMode): Pose {
  return { E: v.E, N: v.N, h: v.h, heading_deg: v.heading, pitch_deg: v.pitch, mode: toZoneMode(mode) };
}

type ZoneSourcePart = Pick<ZoneManifest, 'id' | 'name_de' | 'attribution'>;

/** One „Quellen“ row per zone attribution entry (verbatim), tagged with the zone's name. */
export function zoneSourceRows(zone: ZoneSourcePart): SourceRow[] {
  return zone.attribution
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const r = rowFromEntry(entry);
      return { ...r, id: `zone:${zone.id}:${i}`, use: r.use ? `${zone.name_de}: ${r.use}` : zone.name_de };
    });
}

const CONFIDENCE_DE = { high: 'hoch', med: 'mittel', low: 'niedrig' } as const;

export interface ZoneLoadingText {
  title: string;
  summary: string;
  /** „Rekonstruktion (Hypothese) · Vertrauen: niedrig“ / „Aufnahme vom 2026-05-01“. */
  evidence: string;
  disclaimer: string;
  /** Joined attribution („a; b“), shown small under the bar. */
  sources: string;
}

export function zoneLoadingText(zone: Pick<ZoneManifest, 'name_de' | 'summary_de' | 'attribution' | 'evidence' | 'capture'>): ZoneLoadingText {
  const ev = zone.evidence;
  const evidence =
    ev.kind === 'capture'
      ? `Aufnahme${zone.capture?.date ? ` vom ${zone.capture.date}` : ''}`
      : `Rekonstruktion (Hypothese) · Vertrauen: ${CONFIDENCE_DE[ev.confidence] ?? ev.confidence}`;
  return {
    title: zone.name_de,
    summary: zone.summary_de,
    evidence,
    disclaimer: ev.disclaimer_de,
    sources: zone.attribution.join('; '),
  };
}
