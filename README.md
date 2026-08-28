# Actor Connect

A movie trivia chain. You get two films — a start and a finish — and a deck of
films that might sit between them. Place the right film in the right slot and
the actor who links it to its neighbour is revealed. Three strikes and it's
over.

```
Con Air (1997)
  └─ Nicolas Cage ──── The Rock (1996)
       └─ Sean Connery ──── The Hunt for Red October (1990)
            └─ Sam Neill ──── Jurassic Park (1993)
                 └─ Laura Dern ──── Blue Velvet (1986)
                      └─ Dennis Hopper ──── Waterworld (1995)
```

SvelteKit 2 (Svelte 5 runes), Tailwind 4, `adapter-node`, SQLite, and TMDB for
all film and cast data.

## Running it

```sh
cp .env.example .env      # add your TMDB key
npm install
npm run dev
```

The database is created on first run at `data/actor-connect.db` and seeded with
the puzzles in `src/lib/server/library.json`.

- `/` — the game
- `/build` — the puzzle builder (dev only by default, see below)
- `/embed-demo` — a stand-in host page, to see the iframe integration working

## Traffic to TMDB

Every response TMDB gives us is written to SQLite and reused from then on, so a
film's cast is fetched **once, ever** — not once per server start, and not once
per puzzle it appears in.

| Action                                     | TMDB calls          |
| ------------------------------------------ | ------------------- |
| Playing a puzzle, start to finish          | 0                   |
| Re-checking a pair of films we've seen      | 0                   |
| Authoring a link between two known films    | 0                   |
| Authoring a link involving one new film     | 1                   |
| A search we've run before (within 30 days)  | 0                   |

The counts are on `/build` rather than being a claim in a readme: every
outbound request is recorded in the `api_calls` table with its path, status and
duration. Measured: authoring the example puzzle from an empty database — six
title searches, six films, five links — costs **12 calls** (6 searches, 6 cast
fetches). Doing the same work again costs **0**.

There's also a throttle in front of the API: at most four requests in flight,
50ms apart. Nothing interactive notices, and a phase-two batch job can't burst
hundreds of requests at them.

### Why anything is cached at all

Playing never needed TMDB — puzzles carry their own copies of the poster paths,
actor names and character names they display, so a published puzzle is frozen
and can't change under a player. The cache is for *authoring*: the builder asks
"who's in both of these?" constantly, and the answer is a SQLite join over cast
we already hold rather than two API calls.

It's also the groundwork for phase two. See below.

## Keeping obscure titles out of the way

TMDB returns `popularity` and `vote_count` on every search result, so this
costs no extra calls. Both are stored; **`vote_count` does the work**, because
it's a count of humans who have rated the thing. `popularity` is only a light
nudge — it measures this week's page views, and a four-vote stand-up special can
out-popularity Heat.

Search results are ranked in two levels ([`rankByFame`](src/lib/server/tmdb.ts)):

1. **Does the title account for what was typed?** Anything that does beats
   anything that doesn't. Matching is per-word and by prefix, so "jurass" finds
   Jurassic Park, and TMDB's fuzzy matches that share no words with the query
   ("Caution to the Wind" for "con air") drop below everything real.
2. **Then fame**, log-scaled: the gap between 8 votes and 800 matters far more
   than 8,000 to 20,000. TMDB's own result position stays in the mix, since it
   carries relevance we can't reconstruct. An exact title match gets a firm
   bonus — enough that "the rock" beats the better-rated School of Rock, not
   enough that a one-vote TV movie called HEAT outranks Red Heat.

The full page of 20 results is ranked and only then cut to eight, so a good
match sitting at position 12 can still surface. Before and after, for "heat":

| | TMDB's order | Ranked |
| --- | --- | --- |
| 1 | Heat (1995) — 8,602 votes | Heat (1995) — 8,602 |
| 2 | WWE Heat — 9 | The Heat (2013) — 4,243 |
| 3 | Night Heat — 8 | Red Heat (1988) — 1,659 |
| 4 | The Heat (2013) — 4,243 | White Heat (1949) — 553 |
| 5 | Heat Guy J — 6 | Body Heat (1981) — 708 |

Searching for something obscure *by name* still works: "night heat" returns In
the Heat of the Night first and Night Heat (8 votes) second.

The rating count is shown in the builder's search dropdown, greyed further when
it's under 50, so an obscure match is obvious before you pick it.

Two smaller uses of the same data:

- Refs are stored in TMDB's order and ranked on read, so changing the formula
  applies to queries already cached rather than only to new ones.
- Candidate connections for a link are ordered by billing **bucketed in fives,
  then by the person's popularity** — so among people billed at roughly the
  same level, the recognisable one comes first. That's the one worth building a
  puzzle around.

## How a round works

The chain alternates titles and connections:

```
start ──links[0]── chain[0] ──links[1]── chain[1] ── … ──links[n]── end
```

**A slot only opens once it has a neighbour you already know**, because that's
what makes a guess an informed one: the film going in has something to share an
actor *with*. A slot with two empty neighbours would be a blind guess, so the
game doesn't offer it.

Both anchor titles are given, so the two ends of the chain are open from the
start and the puzzle can be worked forwards from the beginning, backwards from
the end, or from both at once, meeting in the middle. Each correct placement
opens the slot beside it.

A connection is revealed once **both** titles either side of it are on the
board. The start and finish are given, so placing the first film reveals the
actor joining it to the start; the final placement reveals two at once, since
the finish title was waiting on the other side of it.

The deck holds exactly the films that make up the chain — no decoys. Every card
belongs somewhere; the puzzle is working out where. One consequence worth
knowing: the last card has only one slot left to go in, so the final placement
is free.

This is enforced on the server as well as in the UI, and a blind placement is
**not** a wrong answer — `/api/guess` returns 409 and costs no strike, because
it can only be a bug or a doctored request. A genuinely wrong film in an open
slot is still a strike. The check runs against the *validated* board, so
claiming to have filled a slot doesn't open its neighbour unless the claim
matches the answer key.

Wrong film, wrong slot, or both: one strike. Three strikes ends the round and
the full chain is shown, as does giving up.

### Answers stay on the server

The browser is sent the two ends, a slot count, and a shuffled deck. The chain
order and the connecting actors are never in the page source. Each placement is
marked by `POST /api/guess`, which re-checks every placement the client claims
to have made against the answer key before it will unlock a connection — a
doctored request can't reveal a link that hasn't been earned. It's a local
database read, so it's fast and costs nothing.

## The database

One SQLite file holds two things that are deliberately together: the durable
TMDB cache, and the puzzles, which reference it rather than copying it.

| Table                                 | What's in it                                             |
| ------------------------------------- | -------------------------------------------------------- |
| `titles`                              | Every film/show we've seen, with `popularity`, `vote_count` and `vote_average`. `cast_fetched_at` is null until we have its full cast |
| `people`, `title_cast`                | The cast graph: who is in what, with billing, character and popularity. `people.credits_fetched_at` marks whose full filmography we hold |
| `searches`                            | Query → the refs it returned                              |
| `api_calls`                           | Every outbound request, for the audit above               |
| `puzzles`, `puzzle_chain`, `puzzle_links` | The puzzles, as references into the tables above |

Schema changes go on the end of the `MIGRATIONS` array in
[`src/lib/server/db.ts`](src/lib/server/db.ts); `user_version` tracks which
have run.

Two things worth knowing:

- **`library.json` is how puzzles travel.** It's imported, so it ships in the
  bundle. **Write to library.json** in the builder exports the database back to
  it, so puzzles you author locally can be committed with the code.
  `PUZZLE_SEED` decides what a boot does with it: `empty` (default) seeds only a
  database with no puzzles, `merge` writes every seed puzzle on every boot so
  the file is canonical — which is what production uses, and what makes a
  redeploy actually deliver new and edited puzzles. See
  [`DEPLOY.md`](DEPLOY.md#7-getting-new-or-edited-puzzles-live).
- **Back up the database file** (or export to the seed) — it's the only copy of
  anything you've authored since.

`title_cast` is filled in from **both ends**: a film's cast fetch inserts sixty
rows for one film, and an actor's filmography inserts a hundred rows for one
person. It's one relation either way, so the two builders feed the same table —
which is why walking the cast graph makes the *next* puzzle cheaper too.

Character names on a link are stored on `puzzle_links` rather than derived from
`title_cast` at read time. A published puzzle shouldn't reword itself because
TMDB edited a credit years later.

## Phase one: authoring puzzles by hand

Two builders, for the two ways you actually think about a chain.

### Walk the cast — `/build/walk`

For when you *don't* know the chain up front. Start with one film, pick an
actor from its cast, pick one of that actor's other films, and keep going. The
first and last films become the two anchors; everything between becomes what
the player places. Each step you take is a connection, already resolved — so
unlike the other builder, nothing needs checking afterwards.

Both lists have a **how well known** dial, because otherwise a film hands you
sixty names and an actor hands you a hundred films:

| List | Filters on | Tiers |
| --- | --- | --- |
| Cast of a film | TMDB person `popularity` | Everyone / Named cast (1) / Recognisable (2) / Big names (3.5) |
| An actor's films | `vote_count` | Anything / Fairly known (250) / Well known (1,000) / Household names (4,000) |

The tiers come from measuring rather than guessing. Con Air's cast is 60 names
with popularity from 0.3 (an extra with one line) to 9.6 (Cage); a floor of 1
leaves 33 and a floor of 2 leaves 20, which is the difference between a wall of
extras and a list you can read. Cast lists stay in **billing order** so the
leads are at the top, with each person's popularity shown as a five-bar meter —
the numbers are too compressed to read raw.

Films are filtered on the **number** of ratings, not the score: a 9.0 with
twelve votes is still obscure. The score is shown (★ 7.9) because it's useful
for picking, just not for filtering.

Films already in the chain are dropped from the list — they'd be right in two
places. An actor already used as a connection is marked `used` rather than
hidden: reusing one is legal, and a run of Bond films joined by Brosnan is a
fine chain, but it makes for a thinner puzzle so it's worth seeing first.

Cost: **one call per new film, one per new actor, never twice.** A film's cast
comes from `/movie/{id}?append_to_response=credits`, an actor's filmography
from `/person/{id}/movie_credits` — one call for their whole career.

### Pick the films — `/build`

For when you already have the chain in mind and want it verified:

1. Name the puzzle, pick the start and finish titles.
2. Add the films in between, in chain order (reorder or drop them as you like).
3. Each adjacent pair is checked for shared cast — from the database where we
   already have it, from TMDB where we don't. The top-billed shared actor is
   chosen as the connection; pick another from the dropdown if a more
   recognisable face is in there. A pair with nobody in common is flagged and
   blocks saving.
4. **Save to library**, or **Copy JSON** to paste in by hand.

Both builders write the same `Puzzle` rows and share the same save endpoint, so
you can start a chain in one and finish it in the other by way of the library.

### Editing an existing puzzle

**Edit** in the library list opens `/build?edit=<id>` with the whole puzzle
loaded: name, both anchors, the chain in order, and — the part that matters —
each connection's dropdown pre-selected with the actor it was *saved* with,
rather than reverting to whoever is top-billed now.

- **The id is fixed while editing.** Renaming a puzzle keeps its id, so a link
  to `/?puzzle=<id>` — or a Laravel page embedding it — doesn't break.
- **Saving over an id keeps its `createdAt` and `source`**, so an edit doesn't
  shuffle the library order or relabel an auto-generated puzzle as hand-made.
- **Structural edits are re-validated.** Removing a middle film re-checks the
  pair it leaves behind: drop Jurassic Park from the example and the builder
  refuses to save, saying The Hunt for Red October and Blue Velvet share nobody.
  You can't quietly write a broken chain.
- If the actor a connection was saved with is no longer in the shared cast — TMDB
  credits do get edited — that connection is flagged rather than silently
  swapped for the top-billed name.

Editing costs **no API calls**: every film involved is already cached, so the
pair lookups come back from SQLite.

| Environment                   | `/build` |
| ----------------------------- | -------- |
| `vite dev`                    | open     |
| production                    | 404      |
| production, `PUZZLE_EDITOR=1` | open     |

The gate matters: `/build` (both builders), `/api/search`, `/api/links`,
`/api/cast`, `/api/filmography` and `/api/puzzles` all spend the TMDB key or
edit the puzzle set, so they're closed in production unless you deliberately
open them — behind your own auth, e.g. a route your
Laravel app proxies.

## Phase two: generating puzzles automatically — not built

Deliberately not started, but the database is most of the groundwork. A
generator only needs to emit the same `Puzzle` rows the builder does with
`source: 'auto'`; nothing in the game changes.

`title_cast` is already a bipartite graph of films and people, indexed both
ways (`title_cast_by_person` exists for exactly this). Once it's populated,
finding chains is a local graph search with **no API calls at all**:

- The graph now grows on its own as a side effect of authoring: the walk
  builder already calls `/person/{id}/movie_credits`, and three actors' worth
  of that took the local graph from ~200 titles to 652, with 1,363 cast rows.
  Author a dozen puzzles and a generator has real ground to search.
- Seed the rest from a pool of well-known actors the same way — one call gives
  every film a person appears in, which is a whole layer at a time. A few
  hundred calls, once.
- Search locally for a path of the desired length between two films, then check
  each hop is a *recognisable* pairing (low billing order on both sides) rather
  than two people who share a stunt double.
- `vote_count` and `people.popularity` are already stored on every row, so a
  generator can require every film in a chain to clear a fame threshold — which
  is the difference between a puzzle that's solvable and one that's merely
  valid.
- Run it as a batch job, not on request. A puzzle a day needs no live API
  access whatsoever.

## Embedding it in Laravel

The game is built to be iframed and to talk to its host.

```html
<iframe id="game" src="https://actor-connect.test/?embed=1&parentOrigin=https://my-laravel-app.test"></iframe>
<script>
	const frame = document.getElementById('game');

	window.addEventListener('message', (event) => {
		if (event.data?.source !== 'actor-connect') return;
		const { type, payload } = event.data;

		if (type === 'height') frame.style.height = payload.height + 'px';
		if (type === 'won') fetch('/api/score', { method: 'POST', body: JSON.stringify(payload) });
	});

	// Drive it from the host side:
	frame.contentWindow.postMessage({ source: 'actor-connect', type: 'load', puzzleId: 'con-air-to-waterworld' }, '*');
</script>
```

**Query parameters**

| Parameter      | Effect                                                      |
| -------------- | ----------------------------------------------------------- |
| `embed=1`      | Drops the page header, nav and background wash               |
| `parentOrigin` | Restricts postMessage to that origin, both ways. Set it.     |
| `puzzle=<id>`  | Loads a specific puzzle instead of the first in the library  |

**Events out** — all `{ source: 'actor-connect', type, payload }`:

| `type`     | `payload`                                        |
| ---------- | ------------------------------------------------ |
| `ready`    | `{ puzzleId, name, slots, strikeLimit }`         |
| `progress` | `{ placed, slots, strikes, strikesLeft }`        |
| `strike`   | `{ strikes, strikesLeft }`                       |
| `reveal`   | `{ index, name, personId }`                      |
| `won`      | `{ strikes, elapsedMs }`                         |
| `lost`     | `{ elapsedMs }`                                  |
| `revealed` | `{}` — the player gave up                        |
| `height`   | `{ height }` — content height, for sizing        |

**Commands in** — `{ source: 'actor-connect', type, … }`:

| `type`    | Extra fields  | Effect                                           |
| --------- | ------------- | ------------------------------------------------ |
| `restart` | —             | Resets the current puzzle                        |
| `load`    | `puzzleId`    | Switches to a puzzle from this app's library     |
| `load`    | `puzzle`      | Plays a whole puzzle object supplied by the host |

That last one is the escape hatch if the puzzles ever want to live in Laravel's
database instead: pass the `Puzzle` in and the game marks it locally rather
than calling `/api/guess`. See `localJudge` in
[`src/lib/game.svelte.ts`](src/lib/game.svelte.ts).

`x-frame-options` is stripped in [`src/hooks.server.ts`](src/hooks.server.ts) so
the frame isn't blocked. Tighten that to your own host if the game ever carries
anything worth clickjacking.

## Playing on a phone

Mobile-first, and the interaction is built for a finger:

- **Tap** a film, then **tap** a slot. The held card stays held while you
  scroll, which matters on a long chain.
- **Drag** a film onto a slot. Pointer events, so it works with finger, mouse
  or pen — HTML5 drag-and-drop doesn't exist on touch. Cards allow horizontal
  panning, so a sideways swipe scrolls the deck while an upward drag picks the
  card up.
- The deck's cards **share the row and grow to fill it** (4rem to 7rem each), so
  a four-film chain gets big posters and a long one falls back to a sideways
  scroll. Posters come from a srcset, so the larger sizes stay sharp without
  making a 1x phone download a 342px image.
- **Keyboard**: cards and open slots are buttons; Enter to pick up, Enter to
  place. Slots that aren't open yet are plain divs, so they're neither
  focusable nor drop targets.
- After a correct placement the board scrolls the slot it just unlocked into
  view — the continuation of whichever end you're working from — using
  `block: 'nearest'` so nothing moves when it's already on screen.

Nothing depends on being able to drag.

## Layout of the code

| Path                        | What's in it                                          |
| --------------------------- | ----------------------------------------------------- |
| `src/lib/types.ts`          | `Puzzle`, `PlayablePuzzle`, the TMDB-shaped basics     |
| `src/lib/game.svelte.ts`    | The engine: placements, strikes, reveals, judges       |
| `src/lib/drag.svelte.ts`    | One pointer gesture, tap or drag                       |
| `src/lib/embed.ts`          | The postMessage bridge                                 |
| `src/lib/server/db.ts`      | The SQLite connection, schema and migrations           |
| `src/lib/server/store.ts`   | Every query: the cache, the cast graph, the puzzles    |
| `src/lib/server/tmdb.ts`    | The only code that talks to TMDB. Throttled and logged |
| `src/lib/server/library.ts` | Puzzle rules: marking guesses, hiding answers          |
| `src/routes/build/`         | The pick-the-films builder                             |
| `src/routes/build/walk/`    | The walk-the-cast builder                              |

## Commands

```sh
npm run dev      # dev server
npm run check    # svelte-check + tsc
npm run build    # production build (adapter-node → ./build)
node build       # run it
```

## Deploying

[`DEPLOY.md`](DEPLOY.md) covers the AWS + Caddy + PM2 setup behind
`movie-connect.r2d20.com`, and [`ecosystem.config.cjs`](ecosystem.config.cjs)
is the PM2 process definition. Short version: the app listens on
`127.0.0.1:9091`, Caddy terminates TLS in front of it, secrets stay in a
gitignored `.env` that Node reads via `--env-file`, and the SQLite database
under `data/` is the only thing worth backing up.
