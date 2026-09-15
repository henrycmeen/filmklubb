# Local closed-voting preview

Branch: `feature/closed-voting-preview`, based on `6452f67` from the existing
Filmklubben ticket implementation. No deployment or real voting changes.

The closed-round view keeps the original TV/trailer and VHS grid. The existing
physical power button overlaps the TV's lower edge, labelled **Se resultatene**.
It glows once on entry. Film clicks only pulse that button; they cannot vote or
open the cases. Clicking the power button mounts the existing TicketFinale with
the frozen ticket. Closing it returns to the TV/grid. Reduced-motion users get
a steady button highlight and the existing finale skips its animation.

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
- Safari responsive mode at 550px: original TV and grid render with the power
  button overlapping the TV edge. Film click adds the accessible button hint
  without opening the finale; power click starts the existing countdown.
- The countdown reaches the frozen PlayTime ticket with date/time/venue;
  Escape returns to the TV/grid without replaying the finale.
- Local round GET returns `closed`, 20 fictional votes and the frozen ticket.

The in-app browser controller was unavailable, so visual testing used Safari.
Production data and deployment are explicitly outside this preview.
