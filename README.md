# GAVRO BARBER — Netlify + Supabase

Kompletan sajt za GAVRO Barber: javna galerija i usluge, online rezervacija u 4 koraka, pregled i otkazivanje sopstvenih termina, mobilni prikaz i administrativni **Barber panel**.

## Šta je uključeno

- Brend GAVRO umesto starog naziva, srpski tekstovi i neprekidna pokretna traka.
- Galerija koja se pravilno raspoređuje i kada postoji samo jedna ili dve fotografije.
- Jedan barber prikazuje se centrirano; kada je samo jedan aktivan barber, ne prikazuje se izbor „Prvi slobodan“.
- Zakazivanje sa proverom radnog vremena i zauzetih termina.
- „Moji termini“: prikaz rezervacija sačuvanih na tom uređaju i bezbedno otkazivanje pomoću privatnog tokena.
- Lepši ekran potvrde i povratak na vrh nakon završetka.
- Redizajniran GAVRO Barber panel u plavo-tamnoj temi, sa mobilnom navigacijom, dostupnom odjavom na telefonu, statusom veze sa API-jem, osvežavanjem podataka i jasnim porukama kada konfiguracija nedostaje.
- Zakazivanja se na mobilnom prikazu prikazuju kao kartice umesto široke tabele; kalendar, forme, usluge, tim, galerija i podešavanja prilagođeni su telefonu i računaru.
- Supabase baze podataka i Storage za fotografije; Netlify Function obrađuje API zahteve.
- Sprečavanje preklapanja termina i na nivou PostgreSQL baze.

## Pre puštanja sajta u rad

1. U Supabase Dashboard-u otvori **SQL Editor** i pokreni ceo fajl `supabase/setup.sql`.
2. U Supabase API podešavanjima pronađi serverski **Secret key** (novi format obično počinje sa `sb_secret_`). Ako tvoj projekat prikazuje samo stariji `service_role` ključ, možeš koristiti i njega. Nemoj ga slati nikome i nemoj ga stavljati u javni frontend.
3. Kopiraj `.env.example` u `.env` i popuni `SUPABASE_SECRET_KEY` (ili stariji `SUPABASE_SERVICE_ROLE_KEY`), `ADMIN_PASS` i `SESSION_SECRET`. `SESSION_SECRET` treba da bude dugačak, nasumičan string.
4. Instaliraj pakete i prenesi početne podatke/fotografije:

   ```bash
   npm install
   npm run seed:supabase
   ```

   Skripta prenosi trenutne usluge, profil Gavre, podešavanja i galeriju u Supabase. Lokalne slike iz `public/uploads` otpremaju se u Storage bucket `gavro-uploads`.

5. U Netlify projektu otvori **Site configuration → Environment variables** i dodaj iste promenljive:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY` (ili stariji `SUPABASE_SERVICE_ROLE_KEY`)
   - `ADMIN_USER`
   - `ADMIN_PASS`
   - `SESSION_SECRET`
6. Deploy preko Netlify CLI ili Git integracije. Primer sa CLI:

   ```bash
   npx netlify-cli login
   npx netlify-cli link
   npx netlify-cli deploy --build --prod
   ```

   Netlify mora da izgradi `netlify/functions/api.js`; samo prevlačenje foldera sa statičnim fajlovima nije pouzdan način za objavljivanje funkcija.

7. Otvori `/admin`, prijavi se korisničkim imenom i lozinkom koje si podesio kroz environment variables i proveri usluge, cene, radno vreme i slike.

## Početne usluge

Početni podaci su preuzeti iz postojećeg projekta, bez oznaka „test“:

| Usluga | Trajanje | Cena |
|---|---:|---:|
| Fade | 40 min | 1.200 RSD |
| Uređivanje brade | 20 min | 600 RSD |

Ove cene i trajanja nisu nezavisno potvrđeni kao konačni cenovnik salona. Proveri ih i izmeni u **Barber panel → Usluge** pre nego što podeliš javni link. Telefon i adresa su ostavljeni prazni umesto da se objavi izmišljeni kontakt; možeš ih dodati u **Uredi sajt**.

## Lokalno pokretanje bez Netlify-a

```bash
npm start
```

Otvori `http://localhost:3000`, a za administraciju `http://localhost:3000/admin`. Lokalni Node server koristi `data/db.json`; Netlify verzija koristi Supabase. Za lokalno pokretanje bez `.env`, prijava je `admin` / `GavroStart!ChangeMe` — ovo je samo lokalna podrazumevana lozinka, nikad je ne koristi na javnom sajtu. Za testiranje Netlify funkcije lokalno koristi `npx netlify-cli dev` nakon što podesiš `.env`.

Ako ne podesiš environment variables, Netlify API namerno prijavljuje da Supabase nije konfigurisan umesto da tvrdi da se podaci čuvaju.

## Bezbednost

- Nikad ne stavljaj `SUPABASE_SECRET_KEY` (ili stariji `SUPABASE_SERVICE_ROLE_KEY`), lozinku baze ili `SESSION_SECRET` u HTML/JS fajlove.
- Ne dodaj javne RLS write policies za ove tabele; API pristupa bazi preko serverske funkcije.
- Promeni sve lozinke koje su ranije podeljene u porukama, naročito PostgreSQL lozinku.
- Pre objavljivanja proveri stvarne cene, radno vreme, kontakt i fotografije.
