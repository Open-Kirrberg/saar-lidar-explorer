/**
 * Pure content for „Über & Datenschutz“ (no DOM): project links and the list of third-party
 * servers the app may contact. tests/about.test.ts scans app/src for request hosts, so a new
 * external service cannot be added without updating this list (and so the privacy text).
 */

export const REPO_URL = 'https://github.com/Open-Kirrberg/saar-lidar-explorer';
export const ISSUES_URL = `${REPO_URL}/issues`;
export const GITHUB_PRIVACY_URL = 'https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement';

export interface ExternalService {
  /** Host name as it appears in the source (Leaflet subdomain templates included). */
  host: string;
  /** Who runs it / what it is (German). */
  name: string;
  /** When the app contacts it (German, truthful about defaults). */
  when: string;
  /** Loaded without any user action on the default settings? */
  byDefault: boolean;
}

export const EXTERNAL_SERVICES: readonly ExternalService[] = [
  {
    host: 'tile.openstreetmap.org',
    name: 'OpenStreetMap-Kartenkacheln (OpenStreetMap Foundation)',
    when:
      'Standard-Hintergrund der Übersichtskarte – wird beim Start ohne weitere Aktion geladen (auch auf dem Handy, wenn die Karte zugeklappt ist). ' +
      'Abschalten: Ebenen-Menü der Karte → „Kein Hintergrund“ (die Wahl bleibt in diesem Browser gespeichert).',
    byDefault: true,
  },
  {
    host: '{s}.tile.opentopomap.org',
    name: 'OpenTopoMap-Kartenkacheln',
    when: 'nur wenn Sie „OpenTopoMap“ als Hintergrund der Übersichtskarte wählen.',
    byDefault: false,
  },
  {
    host: 'geoportal.saarland.de',
    name: 'Geoportal Saarland (Landesamt für Vermessung, Geoinformation und Landentwicklung)',
    when:
      'nur wenn Sie in der Übersichtskarte „Luftbild (DOP20)“, „Flurstücke“ oder „Gemarkung/Flur“ einschalten, ' +
      'und für die Flurstücksabfrage (siehe oben).',
    byDefault: false,
  },
];

/** Hosts that only appear as links (opened on click) or as XML namespaces — never requested by the app. */
export const LINK_ONLY_HOSTS: readonly string[] = [
  'www.openstreetmap.org',
  'www.govdata.de',
  'leafletjs.com',
  'opentopomap.org',
  'opendatacommons.org',
  'www.w3.org',
  'github.com',
  'docs.github.com',
  // „Quellen und Lizenzen“ dialog (ADR 0026): licence and dataset links
  'creativecommons.org',
  'de.wikipedia.org',
  'geobasis-rlp.de',
  'www.shop.lvgl.saarland.de',
  'www.geoportal.rlp.de', // V2.9 dataset URIs (RLP ALKIS WFS, DOP20 WMS)
  'geo4.service24.rlp.de',
];

/** Hosts of the deployment itself (site + data repositories on GitHub Pages) and local dev. */
export const OWN_HOSTS: readonly string[] = ['open-kirrberg.github.io', 'localhost'];

export interface HostingText {
  text: string;
  /** Hosted on GitHub Pages (page or data) → link GitHub's privacy statement. */
  github: boolean;
}

const isGithubPages = (host: string) => /(^|\.)github\.io$/i.test(host);

/** „Hosting“ paragraph for the page host and the data host (truthful for the public site and local runs). */
export function hostingText(pageHost: string, dataHost: string): HostingText {
  const page = pageHost.toLowerCase();
  const data = dataHost.toLowerCase();
  const ghPage = isGithubPages(page);
  const ghData = isGithubPages(data);
  const gh =
    'GitHub Inc. verarbeitet dabei technisch notwendige Verbindungsdaten, insbesondere Ihre IP-Adresse, u. a. in Server-Logs.';
  let text: string;
  if (ghPage) {
    text = `Diese Website wird über GitHub Pages (GitHub Inc., USA) ausgeliefert. ${gh}`;
    text +=
      data === page
        ? ' Auch die Gelände-, Relief- und Kartendaten werden von dort geladen.'
        : ` Die Gelände-, Relief- und Kartendaten werden von ${data}${ghData ? ' (ebenfalls GitHub Pages)' : ''} geladen.`;
  } else {
    text = `Diese Installation wird von ${page || 'diesem Rechner'} ausgeliefert`;
    text += data === page ? ', von dort kommen auch die Gelände- und Kartendaten.' : `; die Gelände- und Kartendaten kommen von ${data}.`;
    if (ghData) text += ` ${data} ist GitHub Pages: ${gh}`;
  }
  return { text, github: ghPage || ghData };
}
