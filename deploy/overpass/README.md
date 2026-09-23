# Sopstvena Overpass instanca za Srbiju

Javni Overpass serveri su nasumično preopterećeni (isti upit odgovori za 3 s ili vrati 504), pa
preuzimanje okoline u aplikaciji štuca. Sopstvena instanca sa podacima samo za Srbiju odgovara
stabilno i ispod sekunde, a nema tuđe redove.

## Šta treba
- VPS sa Docker-om: 2 CPU, 4 GB RAM, 20 GB diska (Hetzner CX22 / DigitalOcean 4 GB ili slično, ~5 €/mesečno).
- Domen ili poddomen (npr. `overpass.mojeparcele.rs`) sa A zapisom na IP servera; portovi 80 i 443 otvoreni.

## Postavljanje (jednom)
```bash
git clone https://github.com/milosmilicevicsf/moje_parcele.git
cd moje_parcele/deploy/overpass
cp .env.example .env
openssl rand -hex 32          # rezultat upišite u .env kao OVERPASS_KEY
nano .env                     # OVERPASS_DOMAIN i OVERPASS_KEY
docker compose up -d
docker compose logs -f overpass   # prvi start: preuzimanje ekstrakta Srbije (~250 MB) i indeksiranje, 20–60 min
```
Instanca je spremna kad u logu vidite da `dispatcher` i `nginx` rade, a ova provera vrati JSON:
```bash
curl -s -H "X-Overpass-Key: $(grep OVERPASS_KEY .env | cut -d= -f2)" \
  "https://VAŠ-DOMEN/api/interpreter?data=[out:json];node(44.81,20.45,44.82,20.47)[amenity];out 1;"
```
Bez ključa Caddy vraća 403 — to je namerno.

## Povezivanje sa aplikacijom
U Vercel → Project → Settings → Environment Variables dodajte, pa uradite Redeploy:
- `OVERPASS_URL` = `https://VAŠ-DOMEN/api/interpreter,https://overpass-api.de/api/interpreter`
  (vaša instanca prva; javni server ostaje kao rezerva ako VPS padne)
- `OVERPASS_KEY` = isti niz kao u `.env`

## Održavanje
- Podaci se sami ažuriraju jednom dnevno sa Geofabrik-a (`OVERPASS_UPDATE_SLEEP=86400`).
- Nadogradnja slike: `docker compose pull && docker compose up -d` — baza ostaje u `./db`.
- Ako baza ikad postane neispravna: `docker compose down`, obrišite `./db`, pa `docker compose up -d` (ponovno indeksiranje).
- Posle promene OSM podataka aplikacija i dalje 7 dana servira keširan odgovor sa Vercel CDN-a; to je očekivano.
