// Dev diagnostic: interior model warnings per detailed building.
import { readFileSync } from 'node:fs';
import { loadSite } from '../../model/src/catalogue.ts';
import { layoutBuilding } from '../../model/src/layout/building.ts';
import { interiorModel } from '../../model/src/interior/model.ts';
const { spec } = loadSite(JSON.parse(readFileSync(new URL('../../model/catalogue.json', import.meta.url), 'utf8')));
for (const b of spec.buildings.filter((x) => x.interior === 'detailed' && x.rooms?.length)) {
  const m = interiorModel(b, layoutBuilding(b, spec));
  console.log(b.id, m.warnings);
}
const b1 = spec.buildings.find((x) => x.id === (process.argv[2] ?? 'KB-B01'))!;
const m1 = interiorModel(b1, layoutBuilding(b1, spec));
for (const st of m1.stairs) {
  if (!st.plan.blocked.length) continue;
  console.log(st.roomId, st.plan.kind, st.plan.notes, JSON.stringify(st.plan.flights.map((f) => [f.start, f.dir, f.width, f.risers])), JSON.stringify(st.plan.landings));
  console.log(m1.openings.filter((o) => st.plan.blocked.includes(o.id)).map((o) => [o.id, o.centre, o.width, o.bottom_h]));
}
