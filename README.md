# Judo Tournament System

Een volledig wedstrijdbeheersysteem voor judotoernooien, gebouwd volgens de reglementen van **Judo Bond Nederland (JBN)** (BondsVademecum 4.03a en 4.03, december 2025).

## Functionaliteiten

- **Toernooi aanmaken** — naam, datum, aantal tatami's
- **Deelnemers importeren** via CSV (naam, club, geslacht, gewicht, geboortejaar)
- **Automatisch categorieën indelen** — JBN-conforme leeftijdscategorieën (U7 t/m Senior) met correcte gewichtsklassen en wedstrijdduur
- **Automatische tatami-toewijzing** — gelijke eindtijd over alle matten, aangrenzende matten voor grote poules
- **Loting genereren** — poule (round-robin ≤5) of dubbele eliminatie (>5)
- **Scorebord** — per tatami, met klok, ippon/waza-ari/shido, osaekomi-timer en gouden score
- **Overzichtsscherm** — alle tatami's tegelijk in één grid
- **Afdrukken** — poulebladen met namen en score-kolommen, bracket-overzichten, per categorie selecteerbaar, liggend A4

## Technische stack

- **Backend**: Node.js + Express + WebSocket (`ws`)
- **Frontend**: Vanilla ES modules, geen build-stap
- **Fonts**: Barlow Condensed (koppen/scores) + Barlow (tekst) via Google Fonts

## Installatie

```bash
npm install
```

## Starten

```bash
# Productie
npm start

# Ontwikkeling (auto-herstart bij wijzigingen)
npm run dev
```

De server draait standaard op poort **3000**. Open `http://localhost:3000` in de browser.

Deel het netwerk-IP met andere apparaten (scorebordbediening, tatami-schermen):
```
http://<server-ip>:3000
```

## Pagina's

| URL | Omschrijving |
|-----|--------------|
| `/` | Startpagina met links naar alle modules |
| `/admin/` | Beheerpaneel — toernooi, deelnemers, categorieën, loting |
| `/tatami/:id` | Scorebord voor tatami *id* (voor groot scherm) |
| `/control/:id` | Bediening voor tatami *id* (voor tablet/telefoon) |
| `/overview/` | Overzicht van alle tatami's |
| `/results/` | Resultaten, poulebladen en brackets (afdrukbaar) |

## CSV-importformaat

```csv
naam,club,geslacht,gewichtKg,geboortejaar
Jan de Vries,Judo Club Amsterdam,M,45,2012
Lisa Bakker,Budokan Rotterdam,F,38,2014
```

| Veld | Waarden |
|------|---------|
| `geslacht` | `M` of `F` |
| `gewichtKg` | getal (decimalen toegestaan) |
| `geboortejaar` | viercijferig jaar |

## JBN-leeftijdscategorieën

| Categorie | Leeftijd | Wedstrijdduur |
|-----------|----------|---------------|
| U7 | 5–6 jaar | 2 min |
| U9 | 7–8 jaar | 2 min |
| U11 | 9–10 jaar | 2 min |
| U13 | 11–12 jaar | 2 min |
| U15 | 13–14 jaar | 3 min |
| U18 | 15–17 jaar | 4 min |
| U21 | 18–20 jaar | 4 min |
| Senior | 21+ jaar | 4 min |

## Afdrukken

Ga naar `/results/` en selecteer de gewenste categorieën via de checkboxes. Gebruik **Afdrukken selectie** voor geselecteerde categorieën of **Alles afdrukken** voor het complete overzicht. Alle pagina's worden automatisch geschaald naar liggend A4.

## Licentie

MIT
