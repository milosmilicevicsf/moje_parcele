# Lekcije

## Ne odlagati problem koji sam već video da se dešava
- Kontekst: tokom razvoja rute za okolinu javni Overpass serveri su vraćali 504 („server too busy") i
  odgovarali 50–90 s. U preporukama sam ipak napisao da će „tri javna servera izdržati prvih par desetina
  korisnika" i da sopstvena instanca može da čeka. Korisnik je odmah prijavio da preuzimanje štuca na produkciji.
- Pravilo: ako sam tokom rada izmerio da nešto puca, to nije „rizik za kasnije" nego postojeći kvar.
  Ili ga rešim odmah, ili ga jasno navedem kao poznat kvar sa merenjima — ne kao nešto što „verovatno neće smetati".
- Pravilo: pre nego što tvrdim da eksterni servis „izdržava", izmeriti ga sa produkcije (ili što bliže njoj)
  u više navrata, uključujući teže slučajeve (gusto naseljeno područje), a ne samo jedan povoljan primer.

## Proveriti tekuću granu pre commit-a i push-a
- Kontekst: commit za „Parcele oko mene" završio je na već spojenoj grani `cursor/overpass-hedging-4690`,
  a `git push -u origin <druga-grana>` je gurnuo staru lokalnu granu, pa PR nije mogao da se napravi.
- Pravilo: pre `git commit` uraditi `git branch --show-current`; nova funkcija → nova grana sa HEAD-a,
  a `git push` bez navođenja tuđe grane.

## Kad zvanični API nije dostupan, snimiti šta radi zvanični klijent
- Kontekst: WMS/WFS GeoSrbije traže nalog i blokiraju datacentar IP-ove; snimak mrežnog saobraćaja iz
  a3.geosrbija.rs pokazao je da klik na mapu ide na isti javni `SearchProxy` endpoint sa `st:"circle"`.
- Pravilo: pre nego što zaključim da funkcija „nije moguća", tražiti od korisnika HAR/curl snimak zvaničnog
  klijenta — obično koristi isti javni endpoint sa drugim parametrima.

## Prazan rezultat nije dokaz da katastar nema podatke
- Kontekst: upit samo nad slojem 586 radio je u Pepeljevcu, ali je vraćao nulu u centru Beograda i na Novom Beogradu. Isti javni servis vraća tamošnje parcele iz sloja 939.
- Pravilo: proveriti javni upit na gradskoj i ruralnoj referentnoj lokaciji; preuzeti sve potrebne katastarske slojeve. Prazan odgovor opisati kao rezultat upita, bez tvrdnje da nema parcela ili digitalizovanog plana.
- Pravilo: za lokalnu pretragu proveriti i starost i prijavljenu tačnost GPS položaja. Testirati grub prvi položaj, prelaz na precizan položaj i odgovor koji stigne nakon promene lokacije.

## Posle izmene HTML-a pogledati stranicu, ne samo testove
- Kontekst: polje „Grupa“ završilo je dvaput u `teren.html` (fajl je praktično jedan red). Testovi traže elemente preko `getElementById`,
  koji vraća prvi element, pa su prolazili; duplikat se video tek na snimku ekrana.
- Pravilo: posle izmene HTML-a proveriti DOM ili snimak u pregledaču; test jedinstvenih `id` sada čuva `teren.html`.
- Pravilo: pre provere u pregledaču odjaviti service worker i obrisati keš kad se `sw.js` nije promenio, inače se vidi stara stranica.

## Provera da test hvata grešku ide korak po korak
- Kontekst: vraćanje starog koda, pokretanje testa i ponovna ispravka poslati su istovremeno; ispravka je stigla pre testa, pa je test „prošao“ i sa greškom.
- Pravilo: izmena, test i vraćanje idu jedno za drugim, i posle vraćanja proveriti da je fajl opet ispravan.
- Ponovljeno 2026-09-29 u drugom obliku: izmena testa i pokretanje testova poslati su zajedno, pa je test pročitao stari fajl i „pao“; ličilo je na nestabilan test. Pravilo: nijedna komanda koja čita fajl ne ide u isti paket sa izmenom tog fajla.

## Poruka koja se ne vidi nije poruka
- Kontekst: na telefonu je panel sa `#message` sakriven iza mape. Poruke „63 parcela…“, „Učitavam parcele oko pina…“ i greške GeoSrbije išle su tamo, pa korisnik na mapi nije video ni napredak ni grešku. Testovi su proveravali tekst `#message`, ne da li je vidljiv.
- Pravilo: za svaku poruku proveriti gde je korisnik kad ona stigne (prikaz „Mapa“ na 390 px) i da li je taj element tamo vidljiv; proveriti na snimku ekrana, ne samo tekstom.

## Merenje u Playwright-u na stranici sa service worker-om
- Kontekst: `page.on('request')` nije video zahteve ka GeoSrbiji kad je stranicu kontrolisao service worker, a `context.on('request')` je neke prijavio dvaput; izgledalo je da aplikacija šalje isti upit dva puta. Posle `route.abort()` i `unrouteAll` zahtevi u istoj sesiji visili su 15–35 s. Emulirana lokacija čuva vreme kad je postavljena, pa je posle 30 s aplikacija s pravom smatra zastarelom.
- Pravilo: zahteve brojati u samoj stranici (omotač oko `fetch` preko `addInitScript` i Resource Timing); posle presretanja zahteva zatvoriti pregledač pre merenja vremena; lokaciju postaviti ponovo neposredno pre svakog učitavanja.

## Dve referentne tačke nisu provera cele zemlje
- Kontekst: posle dodavanja sloja 939 za Beograd, „parcele oko mene“ su i dalje vraćale nulu u Nišu, Kragujevcu i celoj Vojvodini,
  jer su parcele podeljene u šest regionalnih slojeva (586, 587, 588, 589, 899, 939). Proveravani su samo Pepeljevac i Beograd.
- Pravilo: kad servis deli podatke po regionima, uzorkovati celu zemlju (20–30 gradova, sva četiri regiona) sa svim slojevima
  iz tekstualne pretrage, i spisak slojeva izvesti iz `layerName` u odgovorima, a ne iz dve tačke.
