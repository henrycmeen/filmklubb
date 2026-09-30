# Drift på egen server

Bruk Node.js 24 og pnpm 10. Appen krever en Node-server og skrivbar lagring; statisk hosting/GitHub Pages støttes ikke. En host med kortlivet eller skrivebeskyttet disk trenger et varig volum. Ett SQLite-oppsett skal betjenes av én appinstans på samme vert, ikke deles mellom uavhengige servere.

## Miljø og varige filer

| Variabel                    | Standard / bruk                                              |
| --------------------------- | ------------------------------------------------------------ |
| `TMDB_API_KEY`              | Valgfri egen nøkkel for filmsøk og nye bilder                |
| `CLUB_DB_PATH`              | `data/club/filmklubb.sqlite`; stemmer, planer og snapshots   |
| `FILM_VOTE_SECRET_PATH`     | `data/club/.film-vote-secret`; stabil stemmeidentitet        |
| `FILMKLUBB_ADMIN_AUTH_PATH` | `data/club/admin-auth.json`; passordhash og sesjonssignering |
| `FILMKLUBB_ADMIN_ORIGIN`    | Nettsidens origin, eksempel `https://filmklubb.example.org`  |
| `FILMKLUBB_LOCAL_ADMIN`     | `1` bare for lokalt førstegangsoppsett i utviklingsmodus     |
| `NEXT_PUBLIC_BASE_PATH`     | Tom for rot; `/filmklubb` for hosting i undermappe           |

Hold SQLite, adminfil og stemmehemmelighet utenfor Git og bevar dem på tvers av nye bygg. Bruk absolutte stier ved drift dersom arbeidsmappen skifter. Genererte bilder i `public/VHS/generated` og `.cache` kan regenereres. Ingen nøkler, cookies, stemmedatabaser eller adminfiler fra andre klubber følger med repoet.

## Før første produksjonsstart

1. Kopier `.env.example` til `.env`, tilpass klubbnavn/ID og lagringsstier.
2. Start `pnpm dev` direkte på verten med `FILMKLUBB_LOCAL_ADMIN=1`. Åpne `http://localhost:3000/<klubb-id>/admin` og velg passord. Hvis du bruker SSH, må oppsettet fortsatt gjøres fra en direkte lokal forbindelse; en proxy/tunnel gir ikke oppsettstilgang.
3. Stopp utviklingsserveren. Fjern lokaloppsettflagget, sett korrekt HTTPS-origin og sett opp HTTPS/reverse proxy hos din host.
4. Kjør `pnpm check`, `pnpm test`, `pnpm build` og `pnpm start` fra prosjektmappen. Åpne offentlig klubbside og admin, og verifiser innlogging og arrangementer.

Ingen automatisk distribusjon eller konto-/DNS-oppretting inngår i repoet. Bruk din hosts vanlige Node-oppsett.

## Undermappe

Sett `NEXT_PUBLIC_BASE_PATH=/filmklubb` **før bygging**. Ruter, API og bildefiler får samme prefiks. Et allerede bygget prosjekt endres ikke ved å sette variabelen først ved oppstart. Admin-origin er fortsatt kun scheme + hostname + eventuell port, uten `/filmklubb`. Verifiser begge offentlig side og admin etter bygging.

## Sikkerhetskopi og oppgradering

Stopp appen før du kopierer SQLite-filen og tilhørende SQLite-journal/WAL-filer, eller bruk et konsistent SQLite-backupverktøy. Bevar også adminfil og stemmehemmelighet separat med begrenset tilgang. Kontroller at sikkerhetskopien kan leses før oppgradering.

Bytt kode og bygg uten å erstatte `data/`, miljøfiler eller hemmeligheter. Verifiser dagens runde, historikken, stemmetall og admininnlogging etterpå. En rollback skal normalt bytte kode, ikke overskrive nyere stemmedata med en eldre database.
