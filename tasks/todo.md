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

- [x] `lib/surroundings.js`: čista logika (validacija lat/lon u Srbiji, bbox, Overpass upit, lista upstream-ova) — testabilna u Node-u
- [x] `app/api/surroundings/route.ts`: GET `?lat&lon` → keš (Cache API, 7 dana) → upstream-ovi iz `env.OVERPASS_URL` redom, sa UA → `{elements,bbox,downloadedAt,source}`
- [x] Klijent: `config.js` → `SURROUNDINGS_URL='/api/surroundings'`; `fetchSurroundings` šalje samo lat/lon, upit više ne gradi klijent
- [x] Testovi za `lib/surroundings.js`
- [x] README: arhitektura, `OVERPASS_URL` env, rate limiting preko Cloudflare pravila
- [x] Verifikacija: `pnpm dev` → `/api/surroundings?lat=44.3374&lon=20.1589` vraća JSON; `pnpm lint`; pregledač

## Pregled 2
- `node --test`: 7/7; `tsc --noEmit` čisto; `pnpm lint` samo jedno upozorenje iz postojećeg koda.
- Uživo kroz `pnpm dev`: prvi poziv 200 (~4 s, upstream), ponovljeni i susedni (~50 m) iz keša ~10 ms;
  400 za nedostajuće/van-Srbije koordinate; 403 za `Sec-Fetch-Site: cross-site`.
- Pregledač: uvoz → „Sačuvaj za teren" → `/api/surroundings` 200, okolina nacrtana, posle reload-a parcela
  se otvara sa okolinom.
- Greške usput: `Number(null)` je 0 pa je prazan `lat` prolazio validaciju (ispravljeno na `?? NaN`);
  keširani Response ima nepromenljive header-e pa je vinext padao (vraća se kopija).
- Nalaz za dalje: javni Overpass serveri su bili preopterećeni tokom razvoja (504 / 50–90 s);
  za više korisnika treba sopstvena instanca na prvom mestu u `OVERPASS_URL`.

# Plan 3: build na Vercelu

Uzrok pada: Vercel detektuje Next.js i traži `.next/routes-manifest.json`, a `pnpm build` pokreće vinext
(Cloudflare Worker u `dist/`). Ruta uvozi `cloudflare:workers` i koristi `caches.default`, što na Vercelu ne postoji.

- [x] `package.json`: `dev`/`build`/`start` → Next.js; vinext skripte pod `*:cloudflare`
- [x] Ruta bez Cloudflare zavisnosti: `process.env.OVERPASS_URL`, Cache API samo ako postoji, CDN `Cache-Control`
      (`s-maxage`), `maxDuration`, ukupni budžet vremena ispod limita funkcije
- [x] Klijent zaokružuje lat/lon na 3 decimale da CDN keš ključ bude stabilan
- [x] `next build` lokalno prolazi; `next start` → ruta radi
- [x] README: deploy na Vercel (env `OVERPASS_URL`)

## Pregled 3
- `next build` prolazi (Turbopack, TS čist); `next start`: `/` → 307 na `/teren.html`, statika i `sw.js` 200,
  ruta 400/403/200 sa `cache-control: public, max-age=86400, s-maxage=604800`.
- 7/7 testova, `tsc` čisto, lint samo staro upozorenje.
- Nije provereno na samom Vercelu (nema pristupa nalogu) — sledeći push na `main` će pokrenuti build.

# Plan 4: preuzimanje okoline štuca na produkciji

Merenja na mojeparcele.vercel.app: selo 2–4 s (CDN HIT 43 ms), centar Beograda 504 posle 49 s.
Direktno: overpass-api.de nasumično 504 „busy" (isti upit čas 3 s, čas 504), ogledala vise >120 s.
Centar Beograda vraća 6,7 MB / 8090 elemenata — previše za telefon.

- [x] Ruta: paralelni „hedged" pokušaji (drugi server posle 5 s, treći posle 10 s), prvi uspeh pobeđuje, ostali se prekidaju;
      jedan retry posle 3 s na 429/504 („busy"); razumljiva poruka „preopterećen"
- [x] Upit: zgrade samo u krugu ~500 m (putevi/voda/šume ostaju ~1 km); centar Beograda 6,7 MB → 3,2 MB
- [x] `deploy/overpass/`: docker-compose (Overpass + Caddy HTTPS + ključ), `.env.example`, uputstvo; ruta šalje `X-Overpass-Key`
- [x] Testovi za novi upit; `next build`; provera rute lokalno
- [x] README + lekcija u `tasks/lessons.md`

## Pregled 4
- Pre: selo 502 posle 50 s (de „busy", ogledalo visi), Beograd 504 posle 49 s na produkciji.
- Posle (lokalno, javni serveri): selo 12,5 s, Beograd 12,7 s, Novi Sad 8,9 s — sve 200. Sa mrtvim prvim
  upstream-om: Beograd 7,6 s (hedging preuzima). Brzina i dalje zavisi od javnih servera; sopstvena instanca je rešenje.
- Nije moguće ovde testirati docker-compose (nema Docker-a); YAML validan, parametri prema dokumentaciji slike.

# Plan 5: „Parcele oko mene" (prostorni upit na SearchProxy)

Nalaz iz snimljenih zahteva a3.geosrbija.rs: klik na mapu = `SearchProxy.asmx/Search` sa
`{"st":"circle","s":"E,N,R","layers":"586,","srsid":"32634"}` — isti endpoint kao pretraga, bez tokena.
Sa R≈150 m vraća sve parcele oko tačke sa `fullGeom`. Satelitski snimak (`basemap.geosrbija.rs`, ss30_2021) ide bez tokena.

- [x] `geo.js`: `wgs84ToUtm34` (obrnuta projekcija) + round-trip test (greška < 1 mm)
- [x] `geosrbija.js`: `searchNearby(e,n,r)` + zajednički poziv; `latinPlace(desc)`; `GEOSRBIJA_URL` u `config.js`
- [x] `teren.js`: dugme „Parcele oko mene" (GPS ili centar mape), crtanje susednih parcela sa brojevima, tap → izbor
- [x] `draw/fit` rade i bez izabrane parcele kad postoje susedne
- [x] Testovi (projekcija, telo upita, parsiranje desc); ručna provera u browseru sa lokalnom imitacijom SearchProxy-ja (6 parcela, tap, drag, čuvanje)
- [x] README
- [ ] Korisnik proverava uživo protiv a3.geosrbija.rs (odavde nedostupan): da li `circle` upit vraća `fullGeom`

## Pregled (plan 5)
- Nova klijentska funkcija, bez servera: isti endpoint kao pretraga, samo prostorni upit. Radi bez `A3TKN` tokena.
- Neprovereno uživo: pretpostavka da `circle` odgovor sadrži `fullGeom` kao i tekstualna pretraga. Ako ne — fallback: za svaki `uid` uraditi tekstualnu pretragu (skuplje).
- Sledeći korak po vrednosti: satelitska podloga `basemap.geosrbija.rs` (ss30_2021, EPSG:32634 mreža, bez tokena), keširana kroz service worker kao opaque odgovori.

# Plan 6: satelitski prikaz, povratak na GPS, eKatastar

- [x] `satellite.js`: Esri World Imagery XYZ pločice kroz `pixel()`; `blankTile=false` + prelaz na roditeljsku pločicu (selo nema z19)
- [x] Dugme Satelit/Mapa (pamti se), kontrastne granice, bez OSM površina preko snimka, bez mreže → obična mapa
- [x] Bug: posle pretrage udaljene parcele ◎ samo pomera mapu (`nearbyMode` ostaje false) → ◎ vraća GPS režim i odmah učitava; izbor ostaje
- [x] „Prikaži parcelu“ iz GPS režima vraća udaljenu parcelu sa njenim susedima; uklonjeno dugme „Parcele oko mene“
- [x] eKatastar: nema javnog API-ja (vlasnici samo uz ugovor sa RGZ-om; javni uvid ima captcha) → link koji kopira broj parcele

## Pregled 6
- 42/42 testa; regresioni test za bug pada na starom kodu.
- Browser (lokalni statički server): snimak se poklapa sa granicom 1227/2, zum iznad z18 bez sivih pločica, izbor se pamti, povratak na mapu radi.
- Esri datum snimka: Pepeljevac 9. 3. 2025, Beograd 9. 4. 2025. GeoSrbija ortofoto je iz 2020–2021.
- Neprovereno uživo: ◎ protiv prave GeoSrbije (odavde blokirana; pokriveno testom sa imitacijom), link na eKatastar (sajt odavde nedostupan).

# Plan 7: pretraga sa predlozima, mapa na telefonu, deljenje linkom

Nalaz usput (prostorni upiti u 32 grada): parcele su u šest regionalnih slojeva. Sa samo 586 i 939 „parcele oko mene“,
pin i okolne parcele vraćaju nulu u Nišu, Kragujevcu, Novom Sadu, Subotici i svuda u regionima 587/588/589/899.

- [x] `geosrbija.js`: slojevi 586, 587, 588, 589, 899, 939 (bez 49 = obrisi naselja i 910 = adrese)
- [x] `geo.js` `latinWords`: vojvođanski opis počinje ćirilicom, rimski brojevi su u oba pisma → `latinPlace` i eKatastar KoID rade i za 899
- [x] Pretraga: `datalist` opština i KO iz `ko-ids.txt`, KO lista po opštini, KO iz jedne opštine popunjava opštinu; `placeNames` vraća dijakritike iz rezultata
- [x] Mapa: zum točkićem i sa dva prsta oko kursora/prstiju, pomeranje sa dva prsta, crtanje jednom po frejmu
- [x] Kratak dodir na prazno samo uklanja izbor; pin tek na dug pritisak (550 ms), Android `contextmenu` ili desni klik
- [x] „Podeli“: `?p=&lat=&lon=` preko Web Share ili kopiranja; otvaranje linka bira parcelu bez GPS-a; opis za pregled linka
- [x] `sw.js` v18, testovi, README

## Pregled 7
- `node --test "tests/*.test.mjs"`: 55/55 (4 nova testa + nove provere u postojećim; test pina prebačen na dug pritisak).
- Uživo (lokalni statički server, Chromium, emulirana lokacija, prava GeoSrbija): Niš 95 parcela, Novi Sad 120 (ranije 0);
  kratak dodir samo uklanja izbor, dug pritisak učitava 210 parcela oko pina; link za Niš otvoren sa lokacijom u Beogradu;
  „Grosnica I“ popunjava Kragujevac, 1500/1 se prikazuje kao „Grošnica I · Kragujevac“, eKatastar KoID 717177.
- Neprovereno: pravi telefon (dug pritisak na iOS-u, Android `contextmenu`, sistemski meni za deljenje), `/api/surroundings` (lokalno nije pokretan).

# Plan 8: moje parcele, terenski alati, beleške i vođenje (tačke 3–7 iz pregleda)

- [x] Tačka 5: obim i dužine stranica (`parcel-measure.js`, UTM metri), natpisi stranica na mapi, obim na kartici
- [x] Tačka 7: predloženo teme najbliže putu ili stazi iz OSM okoline (`roadVertex`), Waze i `geo:` na Androidu (`navigation.js`)
- [x] Tačka 3: naziv i boja parcele, sačuvane parcele u svakom režimu mape, „Sve moje parcele na mapi“, grupe po mestu sa zbirom (`portfolio.js`)
- [x] Lična polja se čuvaju odmah (neprimljena parcela se sačuva bez preuzimanja); „Sačuvaj za teren“ koji je već bio u toku ih ne pregazi
- [x] Tačka 6: beleška, sopstvene tačke (krstić ili GPS), fotografije u zasebnoj IndexedDB prodavnici (baza v2), brisanje parcele briše i fotografije
- [x] Tačka 4: vođenje pešice (`guide.js`, `compass.js`): strelica i udaljenost, kompas, konus pravca, ekran ne gasne, vibracija na granici i na tački
- [x] Novi moduli u `sw.js` (v22), testovi, README

## Pregled 8
- `node --test "tests/*.test.mjs"`: 66/66 (novi `tests/field-tools.test.mjs` za čiste module + testovi aplikacije za svaku funkciju).
- Uživo (Chromium, emulirana lokacija, prava GeoSrbija): parcela 980 u Nišu dobila naziv, boju, belešku, tačke i dve fotografije;
  sve vraćeno posle ponovnog učitavanja (baza v2); brisanje parcele obrisalo i fotografije; „Ulaz sa puta“ postao predloženo odredište;
  vođenje: 40 m, strelica prema severu, posle događaja kompasa (uz dozvolu za senzore) 270°; sveža fotografija dobila lokaciju ±6 m.
- Nalazi usput: ovaj Chromium ima `DeviceOrientationEvent.requestPermission` i bez dozvole za senzore vraća „denied“; aplikacija tada
  usmerava strelicu prema severu i nudi dugme „Kompas“. Stari service worker služi stare fajlove dok se nova verzija ne aktivira i stranica
  ne učita ponovo (postojeće ponašanje, stavka 27 pregleda).
- Neprovereno: pravi telefon (kompas na iOS-u i Androidu, vibracija, Screen Wake Lock, kamera), zaključavanje ekrana u instaliranoj PWA.
