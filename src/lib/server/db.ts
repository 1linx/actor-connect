import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '$env/dynamic/private';

/**
 * The one SQLite connection.
 *
 * Two jobs live in this database, and they're deliberately in the same file:
 *
 *  1. A durable cache of everything we've ever pulled from TMDB — title
 *     summaries, full cast lists, search results. It never expires by itself,
 *     so a film's cast is fetched once and reused forever after.
 *  2. The puzzles themselves, which reference those cached titles and people
 *     rather than copying them.
 *
 * Together they mean authoring a puzzle from films we already know about costs
 * *no* API calls, and playing one never did.
 *
 * better-sqlite3 is synchronous, which is the right shape here: every query is
 * a local file read measured in microseconds, and there's no connection pool to
 * think about.
 */

const DEFAULT_PATH = 'data/actor-connect.db';

const path = () => resolve(process.cwd(), env.DATABASE_PATH?.trim() || DEFAULT_PATH);

/** Where the database file lives — shown in the builder. */
export const databasePath = path;

function open(): Database.Database {
	const file = path();
	mkdirSync(dirname(file), { recursive: true });

	const db = new Database(file);
	// WAL lets a read (someone playing) proceed while a write (the builder
	// saving, or a cast being cached) is in flight.
	db.pragma('journal_mode = WAL');
	db.pragma('synchronous = NORMAL');
	db.pragma('foreign_keys = ON');
	migrate(db);
	return db;
}

/**
 * Append-only list of schema steps. `user_version` records how many have run,
 * so adding a migration later is a matter of pushing a string onto the end.
 */
const MIGRATIONS: string[] = [
	/* 1 — TMDB cache and puzzle storage */ `
	create table titles (
		media_type      text    not null check (media_type in ('movie', 'tv')),
		tmdb_id         integer not null,
		title           text    not null,
		year            text,
		poster_path     text,
		fetched_at      integer not null,
		-- null until we've pulled the full cast for this title.
		cast_fetched_at integer,
		primary key (media_type, tmdb_id)
	) without rowid;

	create table people (
		tmdb_id      integer primary key,
		name         text not null,
		profile_path text
	);

	create table title_cast (
		media_type text    not null,
		tmdb_id    integer not null,
		person_id  integer not null references people (tmdb_id),
		-- Character name(s), already collapsed where someone is credited twice.
		character  text    not null default '',
		-- TMDB billing order. Lower is higher billed; null means unbilled.
		billing    integer,
		-- Episode count for shows, null for films.
		episodes   integer,
		primary key (media_type, tmdb_id, person_id)
	) without rowid;

	create index title_cast_by_person on title_cast (person_id);

	-- Search results, so re-typing a query we've already answered is free.
	create table searches (
		query      text    primary key,
		-- JSON array of "movie:123" refs; the titles themselves live above.
		refs       text    not null,
		fetched_at integer not null
	) without rowid;

	-- Every outbound TMDB request, so the traffic we generate is auditable.
	create table api_calls (
		id     integer primary key autoincrement,
		path   text    not null,
		status integer,
		ms     integer,
		at     integer not null
	);

	create table puzzles (
		id           text    primary key,
		name         text,
		start_media  text    not null,
		start_id     integer not null,
		end_media    text    not null,
		end_id       integer not null,
		strike_limit integer not null default 3,
		source       text    not null default 'manual',
		created_at   integer not null
	);

	-- The films to place, in chain order. position 0 is the first slot.
	create table puzzle_chain (
		puzzle_id  text    not null references puzzles (id) on delete cascade,
		position   integer not null,
		media_type text    not null,
		tmdb_id    integer not null,
		primary key (puzzle_id, position)
	) without rowid;

	-- The connections. position 0 is the link leaving the start title, so there
	-- is always one more of these than there are chain entries.
	--
	-- The two character names are stored rather than derived from title_cast: a
	-- published puzzle shouldn't change its wording because TMDB edited a
	-- credit years later.
	create table puzzle_links (
		puzzle_id   text    not null references puzzles (id) on delete cascade,
		position    integer not null,
		person_id   integer not null references people (tmdb_id),
		role_before text,
		role_after  text,
		primary key (puzzle_id, position)
	) without rowid;

	create table puzzle_decoys (
		puzzle_id  text    not null references puzzles (id) on delete cascade,
		media_type text    not null,
		tmdb_id    integer not null,
		primary key (puzzle_id, media_type, tmdb_id)
	) without rowid;
	`,

	/* 2 — fame signals, so obscure titles stop crowding out search results */ `
	-- TMDB's own trending score. Useful, but a poor measure of fame on its own:
	-- a four-vote stand-up special can out-popularity Heat.
	alter table titles add column popularity real not null default 0;
	-- How many people have rated it. This is the signal that actually separates
	-- a film you've heard of from one you haven't.
	alter table titles add column vote_count integer not null default 0;
	-- Same idea for people, used to rank the candidate connections for a link.
	alter table people add column popularity real not null default 0;
	`,

	/* 3 — decoys dropped: the deck is just the films that make up the chain */ `
	drop table puzzle_decoys;
	`
];

function migrate(db: Database.Database) {
	const done = db.pragma('user_version', { simple: true }) as number;

	for (let version = done; version < MIGRATIONS.length; version++) {
		const step = MIGRATIONS[version];
		db.transaction(() => {
			db.exec(step);
			// Can't parameterise a pragma, and the value is a loop counter.
			db.pragma(`user_version = ${version + 1}`);
		})();
	}
}

/**
 * Hot module reload re-evaluates this file; without stashing the connection a
 * dev session accumulates one per save.
 */
const CONNECTION = Symbol.for('actor-connect.db');
const store = globalThis as unknown as Record<symbol, Database.Database | undefined>;

export const db: Database.Database = (store[CONNECTION] ??= open());

export const now = () => Date.now();
