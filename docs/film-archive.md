# Tidligere visninger

Klubbsiden viser gjennomførte runder fra eksisterende, offentlige snapshots
nedenfor programmets første skjermhøyde. Arkivet endrer ingen stemmer eller
databaseskjemaer. Den daterte vinnerkassetten blir første rad i resultatlisten
ved åpning; det opprettes ingen ekstra vinner. Hele den lagrede rangeringen
vises med stemmer og TMDB-score.

Kassetten går inn på 1500 ms og kommer ut på 650 ms. Deretter vises statistikk
og de ti første radene trinnvis; resterende rader vises samlet. Redusert
bevegelse hopper over animasjonene. Siden beholder normal scrolling, uten
dialog, billettutskrift eller automatisk hopp ved åpning fra arkivhyllen.

Før visningstidspunktet beholder «Se resultatene» eksisterende billettfinale.
Fra visningstidspunktet brukes den direkte resultatlisten. Tidspunktet
beregnes fra snapshotets `scheduledAt`, ikke en hardkodet septemberdato.
Den illustrerte teipen gjelder 22.09.2026; andre datoer bruker dynamisk tekst.
«Stemmegivere» er det brukervennlige navnet på antall registrerte
nettleseridentiteter, ikke en garanti for antall unike personer.

## Publisering

Bygg kun versjonskontrollert appkode og teipbildet. Arkivprototypen, dens
prøvedata og Cloudflare-gatewayen er lokale og skal ikke publiseres.
Ta konsistent SQLite-backup ved stoppet tjeneste, behold eksisterende `data/`,
miljøfiler og credentials, og verifiser tabellinnhold før/etter kodebyttet.
Forrige kode og bygg kan gjenopprettes uten å rulle databasen tilbake.
