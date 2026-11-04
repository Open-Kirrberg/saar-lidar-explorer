/**
 * „Gehe zu“ highlights of the castle zone (V2.7, Standard tier): eight places in tour order, ids of the viewer's POIs
 * (views.ts overviews, sitePois rooms `KB-Bxx/<roomId>`). Labels ≤ 24 characters (phone bar). The full list of places
 * („Alle Orte“) stays in the Labor tier.
 */
export interface Highlight {
  id: string;
  label_de: string;
}

export const HIGHLIGHTS: readonly Highlight[] = [
  { id: 'view-west', label_de: 'Schloss von Westen' },
  { id: 'view-ehrenhof', label_de: 'Ehrenhof' },
  { id: 'KB-B01/B01.1.eg-prunktreppe', label_de: 'Prunktreppenhaus' },
  { id: 'KB-B01/B01.2.og-festsaal', label_de: 'Festsaal' },
  { id: 'KB-B06/B06.1.bildergalerie', label_de: 'Bildergalerie' },
  { id: 'view-east', label_de: 'Gartenseite' },
  { id: 'KB-B10/B10.1.s-pfeilersaal', label_de: 'Orangerie' },
  { id: 'view-karlslust', label_de: 'Karlslust' },
];

/** The default start (standalone and zone without a spawn). */
export const DEFAULT_HIGHLIGHT = 'view-west';
