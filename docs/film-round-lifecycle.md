# Runder, datoer og admin

Hver filmkveld har en stabil runde-ID, kandidater, sted og en tidsplan. Nye installasjoner begynner uten en aktiv runde. Opprett første arrangement på `/<klubb-id>/admin`; publiserte arrangementer vises på `/<klubb-id>`.

## Tidspunkter i Europe/Oslo

| Tidspunkt                | Betydning                                  |
| ------------------------ | ------------------------------------------ |
| Stemmestart              | Når klubben kan begynne å stemme           |
| Stemmefrist              | Når serveren stopper nye stemmer           |
| Resultat                 | Når vinneren og stemmetall blir offentlige |
| Visning                  | Når filmen skal vises; brukes på billetten |
| Slutt på resultatperiode | Når arrangementet går til historikken      |

Tidene må være i denne rekkefølgen. Skjemaet viser valideringsfeil før lagring. Publiserte resultat-/stemmeperioder kan ikke overlappe. Kandidater og metadata fryses når en publisert avstemning starter. En ny kladd påvirker ikke dagens stemmer. «Avslutt nå» låser og offentliggjør med én gang; en lukket runde kan ikke gjenåpnes.

Admin grupperer arrangementer som aktive, planlagte og historiske. Velg et arrangement for å redigere; opprett neste separat. Filmutvalg og intern ID er sammenfoldet, og navigasjon varsler om ulagrede endringer.

## Resultater og historikk

Serveren håndhever fristen i samme transaksjon som en stemme. Avslutningen materialiseres ved første relevante forespørsel etter fristen; det kreves ingen cronjobb. Åpne nettlesere sjekker rundefasen hvert 15. sekund når de er synlige. Ingen forespørsel etter fristen kan legge til eller fjerne en stemme. API-ene holder resultatene tilbake til offentliggjøring.

Resultatet fryses som et snapshot med vinner, alle stemmetall og billett. Etter resultatperioden går runden til historikken ved neste forespørsel. Tidligere visninger ligger under klubbens nåværende program og på `/<klubb-id>/historikk`. En enkelt runde kan åpnes med `/<klubb-id>?screening=<runde-id>&result=1`.

Før visning bruker vinnerresultatet billettfinalen. Fra visningstidspunktet åpner det resultatlisten direkte. Arkivet bevarer stemmene fra hver runde; det kopierer dem ikke til neste avstemning.

## Admin og lagring

Første passord settes direkte på servermaskinen i utviklingsmodus med `FILMKLUBB_LOCAL_ADMIN=1`. Det krever ekte loopbackforbindelse og lokal Host; proxy og tunnel godtas ikke. Serveren lagrer scrypt-hash, salt og separat sesjonssignering med filmodus `0600`. Passordet skal aldri i Git.

Innlogging bruker en signert åttetimers HttpOnly/SameSite-cookie, også Secure over HTTPS. Skrivehandlinger krever både sesjon og riktig Origin. Innlogging har rate limit. Sett `FILMKLUBB_ADMIN_ORIGIN` til riktig HTTPS-origin og bevar `FILMKLUBB_ADMIN_AUTH_PATH` på varig lagring før offentlig drift. Se [driftsveiledningen](self-hosting.md).

## Eldre installasjoner

`activeScreening` i programfilen støtter eldre filbaserte runder. Behold slike ID-er når du oppgraderer en eksisterende klubb. Sett den til `null` for nye klubber. Databasetabellen `film_rounds` er additiv; kodeoppgradering skal aldri erstattes med sletting av databasen.

Terminalverktøyet `scripts/club/lock-round.ts` er for kontrollert håndtering av eldre runder. Kjør uten `--commit` for å lese ID og revisjon først. Vanlig planlegging og avslutning skjer i admin.
