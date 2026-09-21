# Rundeplan og admin – lokal implementasjon

## Beslutning

Behold VHS/TV-uttrykket, alle filmer og den eksisterende billettskriveren.
Administrasjonen skal styre en stabil runde-ID, kandidater, sted og disse tidene
i **Europe/Oslo**:

1. Stemmestart og stemmefrist.
2. Offentliggjøring av resultatet.
3. Visningstid og hvor lenge resultatet er hovedvisningen.

«Avslutt nå» lukker og offentliggjør samtidig. September vises til
22. september 2026 kl. 23.59 Oslo. Oktober er ikke datofestet; skjemaet for
neste runde starter uten oppdiktede datoer. En databasekladd krever foreløpig
at tidsfeltene er fylt ut, og publiseres ikke før administrator velger det.

## Ruter og bevaring

- `/NA/admin`: passordbeskyttet styring av nåværende/neste runde.
- `/NA`: åpen avstemning, ventetilstand, avsluttet runde eller ingen neste runde.
- `/NA/historikk`: gjennomførte runder.
- `/NA?screening=<stabil-id>&result=1`: gammel vinner, billett og alle resultater,
  uten å måtte spille finalen på nytt.

Alle ruter får installasjonens `NEXT_PUBLIC_BASE_PATH` foran seg. I denne
forhåndsvisningen er det `/filmklubb`.

`film_rounds` er en additiv SQLite-tabell i samme database som stemmene.
Eksisterende, uplanlagte runder virker som før. En kladd for neste runde
endrer ikke dagens stemmer. Publiserte tidsintervaller kan ikke overlappe.
Endringer bruker revisjonskontroll. Metadata/kandidater fryses når en
publisert avstemning starter, og det endelige resultatet lagres uforanderlig.

Serveren håndhever stemmefristen i samme transaksjon som en stemme. Avslutning
materialiseres ved første relevante forespørsel etter fristen, ikke av en
separat timer. Etter `displayUntil` markeres runden som gjennomført ved neste
forespørsel. Åpne nettlesere sjekker rundefase hvert 15. sekund når de er synlige.
Ingen forespørsel etter fristen kan legge til/fjerne en stemme. Resultater
holdes tilbake frem til offentliggjøring i både runde-, stemme- og resultat-API.

## Passord

Administrator velger selv passordet i det lokale oppsettsskjemaet, minst 10 tegn.
Ikke send passordet i chat eller legg det i Git. Serveren lagrer scrypt-hash,
tilfeldig salt og separat sesjonssignering i en fil med modus `0600`.
Innlogging bruker en signert åttetimers HttpOnly/SameSite-cookie; HTTPS bruker
også Secure. Handlinger krever både sesjon og riktig Origin, og innlogging
har begrensning per socketadresse, uten å stole på klientens forwarding-header.

Lokalt oppsett krever `FILMKLUBB_LOCAL_ADMIN=1`, ikke-produksjonsmodus, ekte
loopbackforbindelse og lokal Host. Proxy/tunnel kan ikke opprette passord.
`FILMKLUBB_ADMIN_AUTH_PATH` peker på den lokale konfigurasjonen; standard er
`data/club/admin-auth.json` (Git-ignorert). Før eventuell publisering må korrekt
HTTPS `FILMKLUBB_ADMIN_ORIGIN` og varig, beskyttet passordlagring konfigureres.
Dette arbeidet publiserer ingenting og endrer ingen produksjonstilganger.

## Lokal test

Runtime på `127.0.0.1:3058` bruker bare `.cache/closed-preview/votes.sqlite`.
`scripts/club/prepare-scheduled-preview.ts` godtar kun den kjente lokale
20-stemmers prøvedatabasen, sikkerhetskopierer prøvestemmer/snapshot og
verifiserer at begge forblir uendret ved registrering av septemberplanen.
Ingen ekte stemmer kopieres. Quick-tunnelens eksisterende, begrensede gateway
viser en eldre statisk forhåndsvisning og gir ikke tilgang til admin.

Regresjonstester dekker frister på grensen, publiseringsvern, ny kladd,
automatisk historikk, uforanderlige snapshots, revisjonskonflikter, kandidat-
delutvalg, Oslo/sommertid og passord/session/Origin/rate-limit.

Før produksjon: gjennomgå og godkjenn diffen, sikkerhetskopier riktig database,
registrer den ekte runden med eksisterende stemmer intakt, sett passord lokalt
og verifiser de faktiske publiseringsadressene. Ingen automatisk produksjons-
migrering eller avstemningslukking er del av lokal oppstart.
