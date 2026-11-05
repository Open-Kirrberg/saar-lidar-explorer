# Messliste – Bäckerei Heusser, Raumplan v0 → Aufmaß

Mit diesen 10 Messungen wird aus dem Entwurf v0 ein gemessener Plan. Die Buchstaben stehen als
Kreise **A–J** auf `raumplan-v0.svg`. Die Planwerte stammen aus dem Mesh (Video). Ihr Maßstab beruht
auf einer *angenommenen* Kamerahöhe und ist deshalb auf **±11 %** unsicher.

**Werkzeug:** Bandmaß (5 m) und Gliedermaßstab. Ein Laser-Entfernungsmesser ist bequemer, misst aber
nicht gegen Glas (B, C und I mit Band). Dazu ein Smartphone mit Wasserwaage und Winkelmesser.
Gemessen wird in **ca. 1,0 m Höhe** über dem jeweiligen Boden, sofern nicht anders angegeben.
Zeitbedarf etwa 30 min, am besten vor Ladenöffnung.

| # | Prio | Was messen | Von → Bis (Plan) | Planwert v0 | Warum |
|---|:-:|---|---|---:|---|
| **A** | ★★★ | **Maßstab, außen am Gehweg:** rechte Laibung von Schaufenster 1 (SW-Kante Pfeiler 1) bis zur Innenkante des freistehenden Eckpfeilers, waagerecht an der Fassade, etwa in Brüstungshöhe | x 18,55 → 24,40 | **5,85 ±0,65** | Eine Messung fixiert den Maßstab **aller blauen Werte**. Strecke lang, freie Sicht, beide Kanten scharf im Mesh |
| B | ★★★ | Ladenbreite innen entlang der Schaufenster: SW-Seitenwand bis Rahmen der Glas-Seitenwand am Eingang | x 16,77 → 21,76 | 4,99 ±0,56 | Zweite lange Strecke, prüft A (Maßstab), die Glaswand und die Lage der SW-Wand |
| C | ★★ | Café-Tiefe an der Nordwand: Glasfront (Türrahmen innen) bis Café-Rückwand. Dazu die Tiefe des Vorbaus: Fassadenflucht bis Glasfront | y 1,52 → 4,11 / 0 → 1,52 | 2,59 ±0,29 / 1,52 ±0,21 | Tiefenrichtung (y) unabhängig von A prüfen |
| D | ★★ | Diagonalwand hinter der Theke (Brotregalwand) von Ecke zu Ecke, über dem Regal gemessen. Dazu der **Winkel** dieser Wand zur Fassade (Plan 45°) | K → I | 4,94 ±0,55 · 45° | Die Schrägwände bestimmen den ganzen Grundriss. Der 45°-Winkel ist aus dem Mesh abgeleitet |
| E | ★★ | Theke: Länge auf der Kundenseite (inkl. Rundung), Tiefe (Granitablage bis Rückseite), Höhe der Granitablage, Oberkante Vitrine | t 13,60 → 17,85 | 4,25 ±0,50 · 1,09 ±0,13 · OK 0,65 / 1,27 | Glas ist im Mesh kaum vorhanden. Wichtigstes Möbel für die Katalog-Platzierung |
| F | ★★ | Gang hinter der Theke (Regal-Vorderkante bis Thekenrückseite), Regaltiefe, Höhe der 4 Böden und der Korbebene (Vorderkante) | c 10,56 → 11,43 | 0,87 ±0,11 · 0,44 · Böden ≈ 0,95/1,25/1,55/1,85 | Slots des Brotregals für Brote im Katalog |
| G | ★ | Raumhöhe: Fußboden bis Unterkante Deckenplatten (Café), bis Unterkante Holz-Abhängung über der Theke, bis Sturz über den Schaufenstern | – | 2,28 ±0,26 · ≈ 2,0 · ≈ 2,05 | Höhen bisher nur aus dem Mesh |
| H | ★ | Wandstärken: Laibung Pfeiler 2 (Fassade) und Nordwand an der Ladentür | – | 0,62 ±0,10 · 0,48 ±0,09 | Verankert die Innenflächen an den LoD2-Außenwänden (survey-fest) |
| I | ★ | Öffnungen: lichte Breite und Höhe der Ladentür (Flügel, Anschlag), Breite des hinteren Durchgangs, **gibt es den Durchgang Backstube an der SW-Wand?** (Lage und Breite), Breiten der Schaufenster, Brüstung und Sturz | – | Glasfront 2,48 ±0,28 · 0,94 ±0,15 · 0,85 ±0,43 (geschätzt) · 1,70 / 2,11 | Das Foto zeigt eine Öffnung links. Im Mesh ist die SW-Wand geschlossen |
| J | ★ | Außen: Stufen (Anzahl, Steigung, Auftritt) Gehweg → Ladenboden; Abholschrank B × T × H (Lage nur im privaten Plan) | y 0 → 1,52 | 5 × 0,144 = 0,72 · 0,95 × 0,40 × 1,70 | Höhenbezug ±0,00 ↔ Straße |

## So wird gerechnet

1. **Maßstab aus A:** `factor = A_Band / 5,85`, z. B. 6,12 m → factor 1,046.
2. In `raumplan-v0.json` `scale.factor` und `scale.source = "tape"` setzen und **denselben Faktor** als
   `package.scale_factor` in `tools/capture/zones/baeckerei-heusser.toml` eintragen (`check_plan.py` prüft das).
   Die Planwerte selbst bleiben unverändert (Mesh-Maßstab 1). Der Twin-Generator (`../build/`) rechnet alle Werte,
   deren `source` „mesh“ enthält (der ganze Innenraum), beim Bauen um:
   - Punkte: `xy' = pivot + factor · (xy − pivot)` mit Pivot (24,656 | 0,000) = LoD2-Nordostecke
   - Längen und Höhen über ±0,00: `L' = factor · L`
3. B, C und D prüfen den Faktor. Weichen sie nach der Umrechnung um mehr als 2 % ab, ist das Mesh
   verzerrt und kein reiner Maßstabsfehler. Dann zählen die Bandmaße direkt (`source = "tape"`, `sigma_m ≈ 0,01`).
4. **Derselbe Faktor gilt für die Explorer-Zone:** Der Pivot ist `capture.scale.pivotLocal` der Zone.
   Danach `zones/baeckerei-heusser/build/run.sh` (Twin neu bauen und ins Zonenpaket übernehmen).
5. E–J sind direkte Maße: als `source: "tape"` eintragen und die Mesh-Schätzung ersetzen.
