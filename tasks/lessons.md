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
