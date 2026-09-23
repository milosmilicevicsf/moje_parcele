# Lekcije

## Ne odlagati problem koji sam već video da se dešava
- Kontekst: tokom razvoja rute za okolinu javni Overpass serveri su vraćali 504 („server too busy") i
  odgovarali 50–90 s. U preporukama sam ipak napisao da će „tri javna servera izdržati prvih par desetina
  korisnika" i da sopstvena instanca može da čeka. Korisnik je odmah prijavio da preuzimanje štuca na produkciji.
- Pravilo: ako sam tokom rada izmerio da nešto puca, to nije „rizik za kasnije" nego postojeći kvar.
  Ili ga rešim odmah, ili ga jasno navedem kao poznat kvar sa merenjima — ne kao nešto što „verovatno neće smetati".
- Pravilo: pre nego što tvrdim da eksterni servis „izdržava", izmeriti ga sa produkcije (ili što bliže njoj)
  u više navrata, uključujući teže slučajeve (gusto naseljeno područje), a ne samo jedan povoljan primer.
