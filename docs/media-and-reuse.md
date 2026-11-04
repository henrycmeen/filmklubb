# Medier og gjenbruk

Prosjektet bruker filmdata, plakater, stillbilder og tittellogoer fra TMDB og trailere fra YouTube. Disse har egne rettighetshavere. TMDB-nøkkelen skal tilhøre din installasjon; følg TMDBs vilkår og kreditering for bruken din.

TV-en på programsiden spiller helst Apples egne trailere og bruker YouTube som reserve. Serveren slår opp filmens «Apple TV movie ID» (P9586) i Wikidata via TMDB-id-en. Deretter henter den traileren fra Apples trailerhylle, først i norsk og så i amerikansk butikk. Nettleseren spiller strømmen direkte fra Apple: Safari og iOS med innebygd HLS, andre nettlesere med hls.js. Dette grensesnittet er ikke offisielt og kan endres uten varsel. Hvis oppslaget feiler, tar mer enn 5 sekunder eller strømmen ikke starter innen 6 sekunder, går TV-en over til YouTube.

VHS-mockuper og illustrasjoner har separate kilder. Egne lisensierte designkilder kan lagres lokalt i `assets/`, mens `public/` inneholder filer appen bruker. Kildemockuper er ikke nødvendige for vanlig kjøring med Sharp. Det er ikke dokumentert en generell redistribusjonslisens for alle mediene i repoet. Ikke anta at en eventuell kodelisens også dekker filmplakater, logoer, mockuper eller videoer.

Koden og prosjektdokumentasjonen er MIT-lisensiert; se [LICENSE](../LICENSE). Denne lisensen gir ikke rettigheter til tredjepartsmedier. Mediekilder som mangler dokumenterte gjenbruksrettigheter må avklares eller erstattes før de distribueres videre.
