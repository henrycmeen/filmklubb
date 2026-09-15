# Local closed-voting preview

Branch: `feature/closed-voting-preview`, based on `6452f67` from the existing
Filmklubben ticket implementation. No deployment or real voting changes.

The closed-round view keeps the original TV frame, showing only analog static.
No trailer, poster or film grid is mounted before the reveal. The existing
physical power button sits just below the TV, labelled **Se resultatene**.
Its face is 64px wide (reduced from 84px), with a 24px power icon.
It glows once on entry. Clicking it mounts the existing TicketFinale with
the frozen ticket. Closing it returns to the static TV. Reduced-motion users get
a still noise texture, a steady button highlight, and no finale animation.

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
- Round and voting API/client/store tests: 48 passing, including frozen ticket/ranking,
  idempotent locking, empty rounds and rejecting added/removed votes after lock.
- Safari responsive mode at 550px: TV shows static with the power button below;
  no film buttons or trailer iframe are present. Power click starts the existing countdown.
- The countdown reaches the frozen PlayTime ticket with date/time/venue;
  Escape returns to the static TV without replaying the finale.
- Local round GET returns `closed`, 20 fictional votes and the frozen ticket.

The in-app browser controller was unavailable, so visual testing used Safari.
Production data and deployment are explicitly outside this preview.
