# Historikk

## 30. september 2026 – stabil trailer og rettelser i eksisterende installasjon

Arbeidsgren: `fix/live-rounds-trailer`. YouTube-spilleren får en avgrenset, gjentatt klar-signal-håndtering, slik at treg iframe-oppstart ikke mister forbindelsen. En avspillingsmelding under TV-oppstart starter nå stabilitetsmålingen; tidligere kunne videoen spille bak et cover som aldri forsvant.

Cover-fallbacken stanser ikke lenger en video som starter sent. Den tar imot sen avspilling og viser videoen igjen. Automatisk oppstart forsøkes maksimalt to ganger. Hvis nettleseren blokkerer autoplay, kan TV-flaten aktiveres med klikk eller Enter/Space uten at en ny iframe mister brukerhandlingen. Meldinger må fortsatt komme fra riktig YouTube-opprinnelse og den aktuelle iframe-en.

Eksisterende installasjoner tar også inn admin-/runde-/stemmetavlerettelsene fra oppføringen under. Den lokale klubbkonfigurasjonen, eldre billettsted og eventuelle egne sider må bevares; malens tomme programfil skal ikke erstatte en eksisterende klubb. Ingen databasemigrering eller endring av passord/stemmehemmelighet er nødvendig.

Publiseringskontroll og resultat føres inn etter verifikasjon. Tilbakerulling gjelder kode og bygg, mens eksisterende produksjonsdata beholdes.

## 30. september 2026 – gjenbrukbart filmklubbgrunnlag

Arbeidsgren: `feature/reusable-filmclub`. Grunnlag: `19004ee` fra siste utviklingsversjon. GitHub-mål: `henrycmeen/filmklubb`. Live tjeneste er ikke oppdatert av denne økten.

### Rettelser som også er aktuelle for eksisterende installasjoner

- Tomme klubber kan ha `activeScreening: null` eller utelatt. De viser ingen åpen avstemning før et arrangement er publisert. En gammel, oppdiktet visningsdato oppretter ikke lenger en ubegrenset avstemning.
- Rundetjenesten skiller en eldre filbasert runde fra en ny installasjon. Kladd holder ny klubb tom; fremtidig publisert runde viser planlagt status; åpen runde bruker den faktisk publiserte rundens stemmetavle.
- Stemmegulvet remonteres ved bytte av faktisk publisert runde, også når kandidatlisten er lik. Dermed følger ikke lokal valgtilstand med til neste visning.
- Admin håndterer at ingen eldre runde finnes ved første opprettelse. Resultatklienten og klubbsiden tåler manglende aktiv visningsdato.
- Eldre stemmetavler tillates ut fra eksplisitt klubbkonfigurasjon, fremfor en hardkodet NA-liste. Ukjente eller uplanlagte tavler skal fortsatt avvises.
- Terminalverktøyet for låsing gir en tydelig melding når ingen eldre runde er konfigurert; nye databaseplanlagte runder styres i admin.
- Nye arrangementer starter med tomt sted; administrator velger faktisk visningssted.
- Lange kombinerte klubb-/runde-ID-er støttes konsekvent opptil 128 tegn i lagring, stemme-API og adminhandlinger. For lange ID-er avvises før lagring; tidligere kunne en runde publiseres uten at stemming eller avslutning fungerte.
- Miljøfiler som `.env.production` og `.env.development` blir også Git-ignorert. Bare `.env.example` er del av malen.

### Tilpasninger som bare gjelder den offentlige malen

- Kjøpte Photoshop-originaler (omtrent 145 MB) er tatt ut av malens nåværende filtre og Git-ignorert; de bevares i tidligere checkouts/Git-historikk. Standard Sharp-kjøring trenger dem ikke. Historikken er ikke omskrevet, og medienes øvrige gjenbruksrettigheter er fortsatt separate.
- Programfilen inneholder bare en tom eksempelklubb, ingen NA-konfigurasjon, alias eller reell visningsdato.
- NA-spesifikk Halloween-forhåndsvisning og lokal prøvedatabase-seeding er tatt ut; generell Halloween-filmkatalog og coverbilder beholdes.
- Billettdemoer bruker et eksempelsted. Kalenderdatoen i demoen er fiktiv; faktiske rundebilletter bruker arrangementets dato og sted.
- README og drifts-/rundeveiledninger beskriver dagens adminflyt, første passordoppsett, varig lagring, backup og hosting i undermappe.
- Maskinspesifikke autonomiregler er erstattet med generelle bidragsregler. Koden og dokumentasjonen er MIT-lisensiert etter eiers valg; tredjepartsmedier er dokumentert separat.

### Slik tas rettelsene inn i liveversjonen på Mac mini

1. Les denne endringslisten og diffen før kodebytte. Live runtime er deployflate, ikke utviklingsrepo.
2. Bevar eksisterende `src/data/filmClubProgramme.json`, klubbalias og faktiske runde-ID-er. **Ikke kopier malens tomme programfil over liveoppsettet.** En eksisterende filbasert avstemning trenger sin gamle `activeScreening` til den eventuelt er kontrollert overtatt i tidsplanen.
3. Bevar databasen, SQLite-journal/WAL, `.env`, adminpassordfil, stemmehemmelighet og genererte runtimefiler. Ta en konsistent backup og kontroller at den kan leses.
4. Ta inn rettelsene i `filmClubProgramme`, `filmRoundService`, `filmScheduleService`, stemme-/admin-API, `filmClubResultsClient` og `ClubProgramHome`, med tilhørende tester. Malendringer som fjerner NA-ruter og erstatter programfilen skal ikke tas inn ukritisk. Bevar også liveinstallasjonens fallback for billettsted ved eldre runder; malens `Eksempelkino` er bare et eksempel og vil ellers brukes ved ny låsing av en eldre runde uten eksplisitt sted.
5. Kjør relevante tester, `pnpm check` og bygg med liveinstallasjonens gjeldende base path. Kontroller deretter dagens visning, innlogging, kandidater, datoer, stemmetall og gamle resultater før offentlig bytte.
6. Deploy er en egen handling. Denne utviklingsøkten endrer ikke live databasen eller tilganger.

Nyeste funksjoner fra før denne økten inkluderer planlagte runder/passordbeskyttet admin, resultater med lagrede stemmetall, inline-arkiv for tidligere visninger og stillbilder inni åpne Halloween-covere. Se Git-loggen fra `f7e36b0` til `19004ee` for de 24 commits som ennå ikke lå på GitHub-main ved oppstart.

### Verifikasjon

- `pnpm install --frozen-lockfile` fra ny worktree uten miljøfil eller database: bestått.
- `pnpm check`: bestått (ingen feil; 43 eksisterende lintadvarsler, primært eldre gulvkomponenter og bildevalg).
- `pnpm test`: 248 tester bestått, ingen feil eller utelatte tester. Nye scenarioer dekker tom oppstart, lange ID-er og eldre klubbkonfigurasjon.
- `pnpm build` på rot og med `NEXT_PUBLIC_BASE_PATH=/filmklubb`: bestått.
- Direkte HTTP-prøve med isolert database: tom klubb, lokalt første passordoppsett, innloggingsvern, fremtidig publisert runde, åpen avstemning, stemming, avslutning, korrekt billettsted og avvisning av sen stemme: bestått.
- Nettleser: tom klubb, avsluttet prøverunde, vinnerbillett med planlagt dato/sted og admininnlogging kontrollert. Ingen konsollfeil/advarsler observert i admin.
- Produksjonsbygg i undermappe: forsiden, klubb, admin, historikk, runde-API, adminsession-API og prefiksede JS-bundles svarte 200; tom klubb var idle.
- Uavhengig kodereview: ID-feil rettet, eldre kompatibilitet verifisert, ingen gjenværende kodeblokkering i avgrenset review.

Testdata og HTTP-prøveskript ligger separat i `.cache/template-smoke`; de er ikke en kopi av live databasen. Git-sporede filer inneholder ingen SQLite-/admin-/hemmelighetsfil; bare `.env.example` er sporet som miljøfil. Dette er en målrettet kontroll, ikke en full historisk hemmelighetsskanning.
