# Filmklubben

Finn neste film sammen. Lag din egen filmklubbside med VHS-covere, avstemning, trailere på en retro-TV og en billett til vinnerfilmen.

[Prøv den offentlige demoen](https://henrymeen.no/filmklubb/) · [Billettgenerator](https://henrymeen.no/filmklubb/billett)

Demoen på forsiden bruker fiktive resultater og lagrer valg i nettleseren. Din egen klubb lagrer arrangementer, stemmer og resultater i SQLite. Repoet inneholder et tomt klubboppsett og et eksempelutvalg av filmer, uten medlemsdata, stemmer eller oppsett fra en faktisk klubb.

## Kom i gang

Du trenger **Node.js 24** og **pnpm 10**. SQLite følger med Node.js; du trenger ingen separat databaseserver. Dette er en Next.js-app med server, og kan ikke kjøres som en statisk GitHub Pages-side.

```bash
git clone https://github.com/henrycmeen/filmklubb.git
cd filmklubb
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Åpne [localhost:3000](http://localhost:3000) for demoen. Filmene som følger med fungerer uten TMDB-nøkkel. Sett din egen `TMDB_API_KEY` i `.env` hvis du vil bruke filmsøk og hente nye bilder og billettlogoer.

## Opprett din egen klubb

1. Endre `name` i [`src/data/filmClubProgramme.json`](src/data/filmClubProgramme.json). Klubb-ID-en `default` gir adressen `/default`; du kan også legge til din egen normaliserte ID, for eksempel `filmvenner`. Behold `default`. Nye klubber bruker `activeScreening: null`, `history: []` og har ingen åpen avstemning før du publiserer et arrangement.
2. Sett `FILMKLUBB_LOCAL_ADMIN=1` i `.env` og start utviklingsserveren på nytt.
3. Åpne [localhost:3000/default/admin](http://localhost:3000/default/admin) direkte på servermaskinen. Velg et adminpassord på minst ti tegn. Førstegangsoppsett fungerer bare lokalt, uten proxy eller tunnel.
4. Opprett et arrangement i admin. Velg kandidatfilmer, visningssted og tidspunktene for stemmestart, stemmefrist, resultat, visning og slutt på resultatperioden. Tidene angis i **Europe/Oslo**.
5. Lagre kladden og publiser når den er klar. Del `/default` med klubben. Du kan planlegge neste arrangement mens det nåværende pågår.

Du setter datoene og styrer arrangementene i admin; du trenger ikke redigere programfilen for hver visning. Admin viser aktive, planlagte og historiske arrangementer og varsler om ulagrede endringer. Filmkatalogen er foreløpig filbasert: se [`src/data/filmVoteCatalogue.json`](src/data/filmVoteCatalogue.json) og `pnpm catalogue:vote` / `pnpm covers:vote` for kuratering med TMDB. Admin velger blant filmene i katalogen.

Ved fristen stenger avstemningen, og resultatet holdes tilbake til offentliggjøring. «Avslutt nå» stenger og offentliggjør med én gang. Vinner, stemmetall og billett lagres samlet. Tidligere visninger får en VHS-kassett med dato og en resultatliste i arkivet. Stemmer og avsluttede resultater bevares når neste arrangement opprettes; lukkede avstemninger gjenåpnes ikke.

[Runder, datoer og admin](docs/film-round-lifecycle.md) · [Tidligere visninger](docs/film-archive.md) · [Drift og sikkerhetskopi](docs/self-hosting.md)

## Kjør på egen server

```bash
pnpm check
pnpm test
pnpm build
pnpm start
```

Fullfør lokalt passordoppsett før du starter produksjonsmodus. Serveren trenger varig, skrivbar lagring for SQLite, adminoppsett og stemmeidentitet. Sett `FILMKLUBB_ADMIN_ORIGIN` til nettsidens HTTPS-origin. Se [driftsveiledningen](docs/self-hosting.md) for miljøvariabler, undermappe og sikkerhetskopi.

## Prosjektets mapper

| Mappe             | Innhold                                     |
| ----------------- | ------------------------------------------- |
| `src/pages`       | Nettsider og server-API                     |
| `src/components`  | VHS-visning, admin, resultater og billetter |
| `src/lib`         | Runderegler, lagring, sikkerhet og tester   |
| `src/data`        | Eksempeloppsett og filmkatalog              |
| `public`          | Bilder, video og statiske filer             |
| `scripts/club`    | Kontrollert administrasjon fra terminal     |
| `scripts/vhs`     | Katalog- og coververktøy                    |
| `docs`            | Bruk, drift og tekniske notater             |
| `data` / `.cache` | Lokale runtimefiler; holdes utenfor Git     |

## Bidra og verifiser

Bruk en egen gren, bevar VHS-uttrykket og kjør `pnpm check`, `pnpm test` og `pnpm build` før en PR. Test endringer i klubbflyten med en separat prøvedatabase, uten produksjonsdata. Se [AGENTS.md](AGENTS.md) for designkontrakten.

Bygget med Next.js og React. Filmdata og bilder fra [TMDB](https://www.themoviedb.org), trailere fra YouTube. Filmplakater, logoer og VHS-kildemateriale kan ha egne rettigheter; se [medier og gjenbruk](docs/media-and-reuse.md). Koden og prosjektdokumentasjonen er [MIT-lisensiert](LICENSE). Medier og tredjepartsressurser omfattes ikke av denne lisensen.
