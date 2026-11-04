/**
 * „Über & Datenschutz“ dialog (public site, required in Germany): what the app is, code licence and
 * data sources, the heritage note, contact (GitHub issues, optional Impressum via
 * `VITE_IMPRESSUM_URL`) and the privacy notes (no cookies/tracking, local-only storage, hosting,
 * third-party map servers from `aboutText.ts`). Modal like the QR dialog: `.sle-overlay`, keys
 * isolated, Tab trapped, Esc / click outside / „Schließen“ close, focus restored.
 */
import { dataRootUrl } from '../data/manifest';
import { impressumUrl } from '../data/urls';
import { EXTERNAL_SERVICES, GITHUB_PRIVACY_URL, ISSUES_URL, REPO_URL, hostingText } from './aboutText';
import { showDisclaimer } from './disclaimer';
import { isolateModalKeys } from './modalKeys';
import './about.css';

const ID = 'sle-about';

export function isAboutOpen(): boolean {
  return !!document.getElementById(ID);
}

function hostOf(url: string): string {
  try {
    return new URL(url, location.href).host;
  } catch {
    return '';
  }
}

function extLink(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

export function openAbout(): void {
  if (isAboutOpen()) return;
  const prevFocus = document.activeElement as HTMLElement | null;
  const wrap = document.createElement('div');
  wrap.id = ID;
  wrap.className = 'sle-overlay';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'sle-about-title');
  wrap.innerHTML = `
    <div class="sle-modal sle-about" tabindex="-1">
      <h2 id="sle-about-title">Über &amp; Datenschutz</h2>

      <h3>Über diese Website</h3>
      <p>Der <strong>Saar LiDAR Explorer</strong> ist ein freies Open-Source-Projekt: ein virtueller Drohnenflug über das
      Laserscan-Geländemodell (LiDAR) des Saarlands und der angrenzenden Pfalz rund um Schloss Karlsberg, Homburg und
      Kirrberg – um Spuren unter dem Wald sichtbar zu machen, etwa Mauern, Gräben, Gruben, Bunker und Hohlwege.</p>
      <p>Quellcode unter MIT-Lizenz: <span data-k="repo"></span>.
      Geländedaten: LVGL Saarland (ALS 2025) und GeoBasis-DE/LVermGeoRP, Lizenz dl-de/by-2-0; Karten: © OpenStreetMap-Mitwirkende (ODbL).
      Die vollständigen Quellenangaben stehen in der Fußzeile<span data-k="srcmobile"> (auf dem Handy unter „ⓘ Quellen“)</span>.</p>
      <p class="sle-about-note"><strong>Schauen, nicht graben.</strong> Markierte Verdachtsflächen sind automatisch erzeugte,
      <em>ungeprüfte Hypothesen</em> und können natürlichen Ursprungs sein. Bodendenkmäler sind gesetzlich geschützt – auch unbekannte.
      <button type="button" class="sle-link" data-act="disclaimer">Hinweise lesen</button></p>

      <h3>Kontakt</h3>
      <p>Fragen, Fehler und Hinweise bitte über die <span data-k="issues"></span> des Projekts.<span data-k="impressum"></span></p>

      <h3>Datenschutz</h3>
      <ul class="sle-about-list">
        <li>Keine Cookies, keine Analyse- oder Tracking-Dienste, keine Werbung, keine Benutzerkonten.</li>
        <li>Einstellungen, Fundmarker, Bewertungen von Verdachtsflächen und Messungen werden nur in Ihrem Browser gespeichert
        (localStorage) und von der App an keinen Server übertragen. Die App fragt Ihren Standort nicht ab.</li>
        <li>Geteilte Links und QR-Codes enthalten nur die Ansicht (Position, Blickrichtung, Darstellung), nie Fundmarker.</li>
        <li><strong>Flurstücksabfrage:</strong> Beim Setzen eines Fundmarkers oder Messpunkts wird das Flurstück zuerst aus den
        mitgelieferten Daten ermittelt. Nur wenn diese die Stelle nicht abdecken (oder Sie es im Bericht ausdrücklich wählen),
        wird die <em>Koordinate</em> an den ALKIS-Dienst des Geoportals Saarland gesendet – Titel und Notizen nie.</li>
        <li data-k="hosting"></li>
      </ul>
      <p>Server Dritter werden direkt von Ihrem Browser angefragt; sie erhalten dabei Ihre IP-Adresse und den angefragten Kartenausschnitt:</p>
      <ul class="sle-about-list" data-k="services"></ul>
      <p class="sle-dim sle-small">Externe Links (z. B. Wikipedia, GitHub) werden erst beim Anklicken geöffnet.</p>

      <div class="sle-actions">
        <span class="sle-spacer"></span>
        <button type="button" class="primary" data-act="close">Schließen</button>
      </div>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => wrap.querySelector<T>(s)!;
  $('[data-k=repo]').appendChild(extLink(REPO_URL, 'github.com/Open-Kirrberg/saar-lidar-explorer'));
  $('[data-k=issues]').appendChild(extLink(ISSUES_URL, 'GitHub-Issues'));
  const imp = impressumUrl();
  if (imp) {
    const span = $('[data-k=impressum]');
    span.append(' ', extLink(imp, 'Impressum'));
  }
  if (!document.documentElement.classList.contains('sle-simple')) $('[data-k=srcmobile]').remove();

  const host = hostingText(location.host, hostOf(dataRootUrl()));
  const hosting = $('[data-k=hosting]');
  const strong = document.createElement('strong');
  strong.textContent = 'Hosting: ';
  hosting.append(strong, host.text);
  if (host.github) hosting.append(' Siehe ', extLink(GITHUB_PRIVACY_URL, 'Datenschutzerklärung von GitHub'), '.');

  const services = $('[data-k=services]');
  for (const s of EXTERNAL_SERVICES) {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = s.name;
    const code = document.createElement('code');
    code.textContent = s.host.replace('{s}.', '');
    li.append(b, ' (', code, '): ', s.when);
    if (s.byDefault) li.classList.add('sle-about-default');
    services.appendChild(li);
  }

  const close = () => {
    uninstallKeys();
    wrap.remove();
    if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
  };
  const uninstallKeys = isolateModalKeys(wrap, (e) => {
    if (e.key !== 'Escape') return false;
    close();
    return true;
  });
  wrap.addEventListener('sle:close', close);
  $('[data-act=close]').addEventListener('click', close);
  $('[data-act=disclaimer]').addEventListener('click', () => {
    close();
    showDisclaimer(true);
  });
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) close();
  });
  (document.querySelector('#app') ?? document.body).appendChild(wrap);
  $('.sle-modal').focus({ preventScroll: true });
}
