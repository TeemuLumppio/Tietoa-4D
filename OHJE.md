# Tietoa 4D – Trimble Connect -laajennus

Visualisoi aikataulun mallissa:
- **Rakentuminen**: objektit ilmestyvät näkyviin aikajanalla (oranssi = työn alla, valmis = oma väri tai vihreä)
- **Suunniteltu vs. toteutunut**: vihreä = valmis, punainen = myöhässä, oranssi = työn alla
- **Tulevat päivämäärät** ovat sallittuja (ei Status Sharingin rajoitusta)
- **Suunnittelu mallissa**: valitse objektit → anna päivämäärät → "Aseta valituille"

Data pysyy käyttäjän selaimessa (localStorage, projektikohtainen). Mitään ei lähetetä ulkopuolelle.
Visualisointi näkyy vain laajennusta käyttävälle käyttäjälle; jaa aikataulu muille viemällä CSV projektin kansioon.

## Asennus (GitHub Pages, n. 10 min)
1. Luo GitHubiin julkinen repo nimeltä `tietoa-4d` ja lataa sinne kaikki tämän kansion tiedostot.
2. Repo → Settings → Pages → Branch: `main` / root → Save. Osoite: `https://KAYTTAJA.github.io/tietoa-4d/`
3. Korvaa `manifest.json`-tiedostossa `KAYTTAJA` omalla GitHub-käyttäjänimelläsi ja tallenna.
4. Trimble Connect → projekti → Settings → Apps & Capabilities → **+ Add Custom** → syötä
   `https://KAYTTAJA.github.io/tietoa-4d/manifest.json`
5. Avaa malli 3D-katselimessa → laajennus näkyy sivupaneelissa.

(Vaihtoehto: mikä tahansa HTTPS-hosting, esim. Azure Static Web Apps.)

## CSV-muoto
Erotin `;` tai `,` tunnistetaan automaattisesti. Suomalaisen Excelin "CSV (puolipiste)" käy suoraan.

| Sarake | Pakollinen | Esimerkki |
|---|---|---|
| GUID | kyllä | `3WXaijjEf77ve09_VwZJ32` (IFC) tai `0c99f9e6-18a5-...` (Tekla) |
| Tunnus | ei | PV-V-0 |
| Alku | ei* | 1.9.2026 |
| Loppu | ei | 15.9.2026 |
| Toteutunut | ei | 14.9.2026 |

*Vähintään yksi päivämäärä per rivi. Päivämäärät: `15.10.2026`, `2026-10-15` tai Excel-päivä.
Tunnistaa myös Teklan raportin otsikot (GUID, PLANNED_START_*, ACTUAL_END_*).

**Vaihe 1 (rakennusosatyyppi)**: aja Teklasta raportti (GUID + kerros + nimi) → Excelissä haetaan Tocomanin
päivämäärät kerros+rakennusosa-yhdistelmällä (XHAKU/VLOOKUP) → tallenna CSV.
**Vaihe 2 (elementti)**: sama, mutta haku elementtitunnuksella.

## Rajoitukset
- Toimii Trimble Connect for Browserissa (ei mobiilisovelluksessa). Mobiilikirjaus → Status Sharing.
- Ei lue eikä muokkaa Status Sharingin statuksia.
- Visualisointi on paikallinen (ei muuta mallia eikä näy muille reaaliajassa).
- Ongelmatilanteissa katso paneelin alaosan **Loki**.
