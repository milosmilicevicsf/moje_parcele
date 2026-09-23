# Plan: jednostavnija aplikacija bez hardkodovane parcele

## Zadaci
- [ ] Ukloniti prepopunjena polja pretrage (1227/2 / Lajkovac / Pepeljevac) iz `teren.html`
- [ ] Ukloniti `public/sample.json` iz app shell-a i iz `boot()`; premestiti ga u `tests/fixtures/` (koristi ga geometrijski test)
- [ ] Prazno stanje: kartica parcele skrivena dok parcela nije izabrana; poruka na mapi šta treba uraditi
- [ ] Zaštititi funkcije koje pretpostavljaju da parcela postoji (`status`, `saveCurrent`, izvoz)
- [ ] Neutralno početno ishodište mape (ne koordinate vlasnikove parcele)
- [ ] `public/config.js`: konfigurabilan Overpass endpoint (preduslov za više korisnika)
- [ ] `sw.js`: nova verzija keša, novi spisak shell fajlova
- [ ] Testovi: fixture putanja, test da HTML nema podrazumevanu parcelu
- [ ] README: poreklo podataka, konfiguracija
- [ ] Verifikacija: `node --test`, ručna provera u pregledaču

## Pregled (posle implementacije)
