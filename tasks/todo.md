# Plan: jednostavnija aplikacija bez hardkodovane parcele

## Zadaci
- [x] Ukloniti prepopunjena polja pretrage (1227/2 / Lajkovac / Pepeljevac) iz `teren.html`
- [x] Ukloniti `public/sample.json` iz app shell-a i iz `boot()`; premestiti ga u `tests/fixtures/` (koristi ga geometrijski test)
- [x] Prazno stanje: kartica parcele skrivena dok parcela nije izabrana; poruka na mapi šta treba uraditi
- [x] Zaštititi funkcije koje pretpostavljaju da parcela postoji (`status`, `saveCurrent`, izvoz)
- [x] Neutralno početno ishodište mape (ne koordinate vlasnikove parcele)
- [x] `public/config.js`: konfigurabilan Overpass endpoint (preduslov za više korisnika)
- [x] `sw.js`: nova verzija keša, novi spisak shell fajlova
- [x] Testovi: fixture putanja, test da HTML nema podrazumevanu parcelu
- [x] README: poreklo podataka, konfiguracija
- [x] Verifikacija: `node --test`, ručna provera u pregledaču

## Pregled (posle implementacije)
- `node --test tests/field.test.mjs`: 6/6 prolazi.
- Ručno u Chrome-u (desktop i 400px): prazna polja, kartica skrivena, hint na mapi, bez grešaka u konzoli;
  uvoz `tests/fixtures/parcel.json` prikazuje poligon T1–T8 i sakriva hint.
- Hint praznog stanja je prvo bio crtan na canvas-u i sekao se ispod dugmadi mape na telefonu;
  prebačen u HTML element (`#emptyHint`) da CSS prelama tekst.
- Ostaje neverifikovano (kao i ranije): pravi GPS na telefonu i hladno otvaranje instalirane PWA bez mreže.

# Plan 2: sopstveni servis za okolinu (preduslov za više korisnika)

Nalaz: GeoSrbija sa datacentar IP-ja ne odgovara (TLS timeout), pa proxy za pretragu ne bi bio pouzdan —
pretraga ostaje direktno iz pregledača. Overpass sa servera radi, ali traži `User-Agent`.

- [ ] `lib/surroundings.js`: čista logika (validacija lat/lon u Srbiji, bbox, Overpass upit, ključ keša) — testabilna u Node-u
- [ ] `app/api/surroundings/route.ts`: GET `?lat&lon` → keš (Cache API, 7 dana) → upstream `env.OVERPASS_URL` sa UA → `{elements,bbox,downloadedAt,source}`
- [ ] Klijent: `config.js` → `SURROUNDINGS_URL='/api/surroundings'`; `fetchSurroundings` šalje samo lat/lon, upit više ne gradi klijent
- [ ] Testovi za `lib/surroundings.js`
- [ ] README: arhitektura, `OVERPASS_URL` env, rate limiting preko Cloudflare pravila
- [ ] Verifikacija: `pnpm dev` → `/api/surroundings?lat=44.3374&lon=20.1589` vraća JSON; `pnpm lint`; pregledač
