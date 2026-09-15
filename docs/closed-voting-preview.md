# Local closed-voting preview

Branch: `feature/closed-voting-preview`, based on `6452f67` from the existing
Filmklubben ticket implementation. No deployment or real voting changes.

The closed-round view now waits for **Se resultatene** before mounting the
existing TicketFinale. No winner, posters or ranking are rendered before that
click. Closing the finale shows the preserved result and moves keyboard focus
to its heading. Reloading returns to the closed landing screen. Reduced-motion
users still choose when to reveal; the existing finale skips its animation.

## Run

From this checkout, with its existing dependencies available:

```sh
node --import tsx scripts/club/seed-closed-preview.ts
CLUB_DB_PATH="$PWD/.cache/closed-preview/votes.sqlite" NEXT_PUBLIC_BASE_PATH=/filmklubb node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3058
```

Open <http://127.0.0.1:3058/filmklubb/NA>.

The seed script creates a **new local** SQLite database with fictional votes
(PlayTime 8, Anatomy of a Fall 7, The Lighthouse 5). It refuses to overwrite
an existing file. On subsequent starts, run only the server command. It does
not read production votes, inherit CLUB_DB_PATH, or contact a live vote API.

## Verification, 2026-09-15

- TypeScript and component ESLint checks pass.
- Round API/client/store tests: 31 passing, including frozen ticket/ranking,
  idempotent locking, empty rounds and rejecting added/removed votes after lock.
- Safari desktop: landing remains closed until click; click opens finale;
  PlayTime ticket rendered with date/time/venue; Escape closes to results and
  focuses the heading; reload restores the landing without autoplay.
- Safari responsive mode: landing fits 320px width, with readable copy and CTA.
- Local round GET returns `closed`, 20 fictional votes and the frozen ticket.

The in-app browser controller was unavailable, so visual testing used Safari.
Production data and deployment are explicitly outside this preview.
