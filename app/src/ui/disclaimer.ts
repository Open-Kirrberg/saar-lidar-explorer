/** "Schauen, nicht graben" disclaimer (F8), text from research/03 §Legal notes. */
import { isolateModalKeys } from './modalKeys';
import { uxoClassesAllowed } from '../data/publicBuild';

/**
 * F22 crater note — only where crater markings can exist (local builds). The public build never shows craters,
 * so it must not mention them either (PRD §9, Q-29).
 */
export function craterDisclaimer(allowed: boolean = uxoClassesAllowed()): string {
  if (!allowed) return '';
  return `
      Bombentrichter- und Trichterfeld-Markierungen sind ein Hinweis, keine Aussage über Kampfmittel/Blindgänger;
      fehlende Markierungen bedeuten nicht, dass eine Fläche kampfmittelfrei ist.`;
}

const KEY = 'sle.disclaimer.v1';

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'hide';
  } catch {
    return false;
  }
}

export function showDisclaimer(force = false): void {
  if (!force && dismissed()) return;
  document.querySelector('#sle-disclaimer')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'sle-disclaimer';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'sle-disclaimer-title');
  wrap.innerHTML = `
    <div class="sle-modal">
      <h2 id="sle-disclaimer-title">Schauen, nicht graben.</h2>
      <p>Alle markierten Strukturen sind <em>Hypothesen</em> aus Geländedaten und können natürlichen Ursprungs sein.
      Bodendenkmäler sind im Saarland gesetzlich geschützt (SDschG §§ 3, 8) – auch unbekannte.
      Gezielte Suche mit Sonden/Werkzeugen ist genehmigungspflichtig; Funde sind unverzüglich dem
      Landesdenkmalamt Saarland zu melden (§ 16). In Rheinland-Pfalz gilt das DSchG RLP (GDKE).
      <strong>Kampfmittelgefahr an Bunkern/Kratern – nichts berühren.</strong>${craterDisclaimer()}</p>
      <p>Viele Waldflächen sind Naturschutz- bzw. Natura-2000-Gebiete: auf den Wegen bleiben.
      Eigene Fundmarker bleiben in diesem Browser; genaue Lagen neuer Funde bitte nicht veröffentlichen.</p>
      <p class="sle-en" lang="en"><em>Look, don't dig. Everything highlighted is a hypothesis from terrain data.
      Archaeological sites are protected by law, even unknown ones. Report observations to the Landesdenkmalamt Saarland.</em></p>
      <div class="sle-actions">
        <label><input type="checkbox" data-k="hide"> nicht mehr anzeigen</label>
        <span class="sle-spacer"></span>
        <button type="button" class="primary" data-act="ok">Verstanden</button>
      </div>
    </div>`;
  const cb = wrap.querySelector<HTMLInputElement>('[data-k=hide]')!;
  cb.checked = dismissed();
  const close = () => {
    try {
      if (cb.checked) localStorage.setItem(KEY, 'hide');
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    wrap.remove();
    uninstallKeys();
  };
  // Esc/Enter close; every other key stays inside the dialog (no shortcuts behind it), Tab is trapped.
  const uninstallKeys = isolateModalKeys(wrap, (e) => {
    if (e.key !== 'Escape' && e.key !== 'Enter') return false;
    close();
    return true;
  });
  wrap.querySelector('[data-act=ok]')!.addEventListener('click', close);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  (document.querySelector('#app') ?? document.body).appendChild(wrap);
  wrap.querySelector<HTMLButtonElement>('[data-act=ok]')!.focus();
}
