/**
 * KL-B43 Menagerie-Terrassen (KB-I29, wave-6 review fix / KB-I67): the row back lines and the watercourse, shared by
 * the building entry (buildings.ts, facade.menagerie) and the beech stand between the rows (terrain.ts, TF-39) and the
 * beech wood round the terraces (landcover.ts, LC-17).
 */
import type { EN } from '../../model/src/spec.ts';

/**
 * Back lines of the rows: 1 m below the LiDAR terrace banks (k -26, -9, 9, 29.5, 50.5, 79 m along the long axis az
 * 156.1 from 383037/5464836), along the bank direction az 75, 3 m inside the LP06 54 outline [D LiDAR KL-02; I].
 */
export const MENAGERIE_ROWS: { p0: EN; p1: EN; houses: number }[] = [
  { p0: [382975.1, 5464845.0], p1: [383061.8, 5464868.2], houses: 13 },
  { p0: [382983.8, 5464829.9], p1: [383069.7, 5464853.0], houses: 13 },
  { p0: [382991.4, 5464813.6], p1: [383077.0, 5464836.5], houses: 13 },
  { p0: [382998.6, 5464794.5], p1: [383085.3, 5464817.8], houses: 13 },
  { p0: [383006.0, 5464775.0], p1: [383093.9, 5464798.6], houses: 13 },
  { p0: [383016.1, 5464748.6], p1: [383105.4, 5464772.5], houses: 13 },
];
/** Grid azimuth the house fronts and the runs face (downhill). */
export const MENAGERIE_FRONT_AZ = 156.1;
export const MENAGERIE_RUN_DEPTH = 9;
/** Centre line of the broad watercourse through the runs [D T1 p. 383 existence; I line]. */
export const MENAGERIE_CHANNEL: EN[] = [
  [383024.8, 5464863.4],
  [383077.5, 5464744.6],
];
