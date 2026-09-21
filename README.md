# Filmklubben

Finn neste film sammen. En enkel filmklubb med VHS-covere, avstemning og trailere på en retro-TV.

**[Prøv demoen →](https://henrymeen.no/filmklubb/)**

I demoen kan du prøve 18 filmer som flytter seg når du velger dem. Valgene finnes bare i nettleseren og nullstilles når siden lastes på nytt. Ingen innlogging eller database er nødvendig for demoen. Nederst kan du avslutte avstemningen, se vinneren med eksempelstemmer og få en filmbillett skrevet ut.

**[Billettgenerator →](https://henrymeen.no/filmklubb/billett)** Søk etter en film, velg farge og visning, og lagre billetten som PNG. Regissør og originale tittellogoer hentes fra TMDB når de finnes.

## Kjør lokalt

Du trenger Node.js 24 og pnpm 10.

```bash
git clone https://github.com/henrycmeen/filmklubb.git
cd filmklubb
pnpm install
pnpm dev
```

Åpne [localhost:3000](http://localhost:3000). Demoen bruker filmene og bildene som følger med prosjektet.

## Din egen filmklubb

Klubbversjonen lagrer stemmer i SQLite. Tilpass filmer i [`src/data/filmVoteCatalogue.json`](src/data/filmVoteCatalogue.json) og visninger i [`src/data/filmClubProgramme.json`](src/data/filmClubProgramme.json). Dette gjøres foreløpig i koden.

For filmsøk og nye billetter fra TMDB: kopier `.env.example` til `.env` og legg inn din egen `TMDB_API_KEY`. De 107 filmene som følger med billettgeneratoren, fungerer også uten API-nøkkel.

### Avslutt en avstemning

Avstemningen avsluttes manuelt, gjerne noen dager før visningen. Ta en SQLite-sikkerhetskopi først. Fra serverens prosjektmappe kan du se gjeldende runde og revisjon uten å endre noe:

```bash
node --env-file-if-exists=.env --import tsx scripts/club/lock-round.ts --club NA
```

Bruk visnings-ID og revisjon fra svaret når du vil låse:

```bash
node --env-file-if-exists=.env --import tsx scripts/club/lock-round.ts --club NA --screening <visnings-id> --expected-revision <revisjon> --commit
```

Låsingen lagrer alle resultater, vinner og billett samlet og stopper nye stemmer. Klubbens side viser deretter avslutningen og resultatene. Databaseplanlagte runder har automatisk frist, offentliggjøring og historikk; se [rundeplan og admin](docs/film-round-lifecycle.md). Lukkede runder kan ikke gjenåpnes.

For neste runde legger du inn en ny, unik visnings-ID og gjør den aktiv i programfilen. Den gamle runden beholdes og kan åpnes på klubbens side med `?screening=<visnings-id>`. Billettens tekst og bildelenker lagres; eksterne bildefiler arkiveres ikke i databasen.

Bygget med Next.js og React. Filmdata og bilder fra [TMDB](https://www.themoviedb.org), trailere fra YouTube. Filmplakater og logoer tilhører sine respektive rettighetshavere.
