import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dev } from '$app/environment';
import { db, now } from './db';
import seed from './library.json' with { type: 'json' };
import {
	titleRef,
	type CreditIn,
	type MediaType,
	type Puzzle,
	type PuzzleLink,
	type SharedPerson,
	type TitleSummary
} from '$lib/types';

/** One person's credit on one title, as stored. */
export interface CastEntry extends CreditIn {
	personId: number;
	name: string;
	profilePath: string | null;
	/** TMDB's trending score for the person, used to rank link candidates. */
	popularity: number;
}

/** How well known a title is. Both come free with a search response. */
export interface FameSignals {
	popularity: number;
	voteCount: number;
}

/** A search result plus the signals the ranking needs. */
export type SearchCandidate = TitleSummary & FameSignals;

/* -------------------------------------------------------------------------- */
/* Statements                                                                 */
/* -------------------------------------------------------------------------- */

const sql = {
	// `cast_fetched_at` is deliberately absent from the update list: re-seeing a
	// title in a search result must not forget that we have its cast.
	upsertTitle: db.prepare(`
		insert into titles
			(media_type, tmdb_id, title, year, poster_path, fetched_at, popularity, vote_count)
		values (@mediaType, @id, @title, @year, @posterPath, @at, @popularity, @voteCount)
		on conflict (media_type, tmdb_id) do update set
			title = excluded.title,
			year = excluded.year,
			poster_path = excluded.poster_path,
			fetched_at = excluded.fetched_at,
			-- Saving a puzzle writes titles with no fame signals attached; don't
			-- let that wipe what a search told us.
			popularity = case when excluded.popularity > 0 then excluded.popularity else titles.popularity end,
			vote_count = case when excluded.vote_count > 0 then excluded.vote_count else titles.vote_count end
	`),
	getTitle: db.prepare(`
		select tmdb_id as id, media_type as mediaType, title, year, poster_path as posterPath
		from titles where media_type = ? and tmdb_id = ?
	`),
	/** As above, plus the signals the search ranking needs. */
	getCandidate: db.prepare(`
		select tmdb_id as id, media_type as mediaType, title, year, poster_path as posterPath,
		       popularity, vote_count as voteCount
		from titles where media_type = ? and tmdb_id = ?
	`),
	castAge: db.prepare(`select cast_fetched_at as at from titles where media_type = ? and tmdb_id = ?`),
	markCastFetched: db.prepare(`update titles set cast_fetched_at = ? where media_type = ? and tmdb_id = ?`),

	upsertPerson: db.prepare(`
		insert into people (tmdb_id, name, profile_path, popularity)
		values (@personId, @name, @profilePath, @popularity)
		on conflict (tmdb_id) do update set
			name = excluded.name,
			profile_path = coalesce(excluded.profile_path, people.profile_path),
			popularity = case when excluded.popularity > 0 then excluded.popularity else people.popularity end
	`),
	clearCast: db.prepare(`delete from title_cast where media_type = ? and tmdb_id = ?`),
	insertCast: db.prepare(`
		insert into title_cast (media_type, tmdb_id, person_id, character, billing, episodes)
		values (@mediaType, @id, @personId, @character, @billing, @episodes)
	`),

	/**
	 * Everyone two titles have in common, ranked by the *better* of the two
	 * billings — someone top-billed in one and a bit-part in the other is still
	 * the face you recognise, whereas summing would bury them under two evenly
	 * obscure extras.
	 *
	 * Billing is bucketed in fives rather than used outright, so that among
	 * people billed at roughly the same level the better-known one comes first.
	 * That's the one worth building a puzzle around.
	 */
	sharedCast: db.prepare(`
		select
			p.tmdb_id                as id,
			p.name                   as name,
			p.profile_path           as profilePath,
			p.popularity             as popularity,
			a.character              as characterA,
			a.billing                as billingA,
			a.episodes               as episodesA,
			b.character              as characterB,
			b.billing                as billingB,
			b.episodes               as episodesB
		from title_cast a
		join title_cast b
			on b.person_id = a.person_id and b.media_type = @bMedia and b.tmdb_id = @bId
		join people p on p.tmdb_id = a.person_id
		where a.media_type = @aMedia and a.tmdb_id = @aId
		order by
			min(coalesce(a.billing, 999), coalesce(b.billing, 999)) / 5,
			p.popularity desc,
			coalesce(a.billing, 999) + coalesce(b.billing, 999),
			p.name
	`),

	getSearch: db.prepare(`select refs, fetched_at as at from searches where query = ?`),
	putSearch: db.prepare(`
		insert into searches (query, refs, fetched_at) values (?, ?, ?)
		on conflict (query) do update set refs = excluded.refs, fetched_at = excluded.fetched_at
	`),

	logCall: db.prepare(`insert into api_calls (path, status, ms, at) values (?, ?, ?, ?)`),

	listPuzzleIds: db.prepare(`select id from puzzles order by created_at, id`),
	getPuzzleRow: db.prepare(`
		select id, name, start_media as startMedia, start_id as startId,
		       end_media as endMedia, end_id as endId, strike_limit as strikeLimit,
		       source, created_at as createdAt
		from puzzles where id = ?
	`),
	getChain: db.prepare(`
		select media_type as mediaType, tmdb_id as id from puzzle_chain
		where puzzle_id = ? order by position
	`),
	getLinks: db.prepare(`
		select l.person_id as personId, l.role_before as roleBefore, l.role_after as roleAfter,
		       p.name, p.profile_path as profilePath
		from puzzle_links l join people p on p.tmdb_id = l.person_id
		where l.puzzle_id = ? order by l.position
	`),
	deletePuzzle: db.prepare(`delete from puzzles where id = ?`),
	insertPuzzle: db.prepare(`
		insert into puzzles (id, name, start_media, start_id, end_media, end_id, strike_limit, source, created_at)
		values (@id, @name, @startMedia, @startId, @endMedia, @endId, @strikeLimit, @source, @createdAt)
	`),
	insertChain: db.prepare(`
		insert into puzzle_chain (puzzle_id, position, media_type, tmdb_id)
		values (@puzzleId, @position, @mediaType, @id)
	`),
	insertLink: db.prepare(`
		insert into puzzle_links (puzzle_id, position, person_id, role_before, role_after)
		values (@puzzleId, @position, @personId, @roleBefore, @roleAfter)
	`),
	count: {
		titles: db.prepare(`select count(*) as n from titles`),
		withCast: db.prepare(`select count(*) as n from titles where cast_fetched_at is not null`),
		people: db.prepare(`select count(*) as n from people`),
		castRows: db.prepare(`select count(*) as n from title_cast`),
		searches: db.prepare(`select count(*) as n from searches`),
		puzzles: db.prepare(`select count(*) as n from puzzles`),
		calls: db.prepare(`select count(*) as n, max(at) as last from api_calls`),
		callsSince: db.prepare(`select count(*) as n from api_calls where at >= ?`)
	}
};

const one = (statement: { get: (...args: never[]) => unknown }, ...args: unknown[]) =>
	(statement.get as (...a: unknown[]) => { n: number } | undefined)(...args)?.n ?? 0;

/* -------------------------------------------------------------------------- */
/* Titles and cast                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Upsert a title. Fame signals are optional: a caller that doesn't have them
 * (saving a puzzle, say) leaves whatever a search previously recorded intact.
 */
export function putTitle(title: TitleSummary, fame?: FameSignals) {
	sql.upsertTitle.run({
		...title,
		at: now(),
		popularity: fame?.popularity ?? 0,
		voteCount: fame?.voteCount ?? 0
	});
}

export const putTitles = db.transaction((titles: TitleSummary[]) => {
	for (const title of titles) putTitle(title);
});

export function getTitle(mediaType: MediaType, id: number): TitleSummary | null {
	return (sql.getTitle.get(mediaType, id) as TitleSummary | undefined) ?? null;
}

/** When we last pulled this title's full cast, or null if we never have. */
export function castFetchedAt(mediaType: MediaType, id: number): number | null {
	return (sql.castAge.get(mediaType, id) as { at: number | null } | undefined)?.at ?? null;
}

/**
 * Replace a title's cast wholesale, and remember that we have it. The details
 * response carries fame signals too, so they come along for free.
 */
export const putCast = db.transaction(
	(title: TitleSummary, cast: CastEntry[], fame?: FameSignals) => {
		putTitle(title, fame);
		sql.clearCast.run(title.mediaType, title.id);
		for (const entry of cast) {
			sql.upsertPerson.run({
				personId: entry.personId,
				name: entry.name,
				profilePath: entry.profilePath,
				popularity: entry.popularity
			});
			sql.insertCast.run({
				mediaType: title.mediaType,
				id: title.id,
				personId: entry.personId,
				character: entry.character,
				billing: entry.billing,
				episodes: entry.episodes
			});
		}
		sql.markCastFetched.run(now(), title.mediaType, title.id);
	}
);

interface SharedRow {
	id: number;
	name: string;
	profilePath: string | null;
	popularity: number;
	characterA: string;
	billingA: number | null;
	episodesA: number | null;
	characterB: string;
	billingB: number | null;
	episodesB: number | null;
}

/** The intersection, computed in SQLite rather than in JS. */
export function sharedCast(
	a: { mediaType: MediaType; id: number },
	b: { mediaType: MediaType; id: number }
): SharedPerson[] {
	const rows = sql.sharedCast.all({
		aMedia: a.mediaType,
		aId: a.id,
		bMedia: b.mediaType,
		bId: b.id
	}) as SharedRow[];

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		profilePath: row.profilePath,
		popularity: row.popularity,
		inA: { character: row.characterA, billing: row.billingA, episodes: row.episodesA },
		inB: { character: row.characterB, billing: row.billingB, episodes: row.episodesB }
	}));
}

/* -------------------------------------------------------------------------- */
/* Searches                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Cached results for a query, or null if we've never run it (or it's stale).
 *
 * Refs are stored in the order TMDB gave them, and the signals come back with
 * each one, so the ranking is applied on read. Changing how results are ranked
 * therefore takes effect immediately, rather than only for queries nobody has
 * run yet.
 */
export function getSearch(query: string, ttlMs: number): SearchCandidate[] | null {
	const row = sql.getSearch.get(query) as { refs: string; at: number } | undefined;
	if (!row || now() - row.at > ttlMs) return null;

	const candidates: SearchCandidate[] = [];
	for (const ref of JSON.parse(row.refs) as string[]) {
		const [mediaType, id] = ref.split(':');
		const found = sql.getCandidate.get(mediaType, Number(id)) as SearchCandidate | undefined;
		// A pruned title just drops out of the cached result rather than
		// poisoning it with a hole.
		if (found) candidates.push(found);
	}
	return candidates;
}

/** Store a search's results in TMDB's own order, with their fame signals. */
export const putSearch = db.transaction((query: string, candidates: SearchCandidate[]) => {
	for (const candidate of candidates) {
		putTitle(candidate, { popularity: candidate.popularity, voteCount: candidate.voteCount });
	}
	sql.putSearch.run(query, JSON.stringify(candidates.map(titleRef)), now());
});

/* -------------------------------------------------------------------------- */
/* Call log                                                                   */
/* -------------------------------------------------------------------------- */

export function logCall(path: string, status: number | null, ms: number) {
	sql.logCall.run(path, status, Math.round(ms), now());
}

export function stats() {
	const calls = sql.count.calls.get() as { n: number; last: number | null };
	return {
		titles: one(sql.count.titles),
		titlesWithCast: one(sql.count.withCast),
		people: one(sql.count.people),
		castRows: one(sql.count.castRows),
		searches: one(sql.count.searches),
		puzzles: one(sql.count.puzzles),
		calls: {
			total: calls.n,
			last: calls.last,
			today: one(sql.count.callsSince, now() - 24 * 60 * 60 * 1000)
		}
	};
}

/* -------------------------------------------------------------------------- */
/* Puzzles                                                                    */
/* -------------------------------------------------------------------------- */

/** A title we no longer have a row for still needs *something* to render. */
const placeholder = (mediaType: MediaType, id: number): TitleSummary => ({
	id,
	mediaType,
	title: 'Unknown title',
	year: null,
	posterPath: null
});

const hydrate = (mediaType: MediaType, id: number) =>
	getTitle(mediaType, id) ?? placeholder(mediaType, id);

export function getPuzzle(id: string): Puzzle | null {
	const row = sql.getPuzzleRow.get(id) as
		| {
				id: string;
				name: string | null;
				startMedia: MediaType;
				startId: number;
				endMedia: MediaType;
				endId: number;
				strikeLimit: number;
				source: string;
				createdAt: number;
			}
		| undefined;
	if (!row) return null;

	const chain = (sql.getChain.all(id) as Array<{ mediaType: MediaType; id: number }>).map((t) =>
		hydrate(t.mediaType, t.id)
	);
	const links = (
		sql.getLinks.all(id) as Array<{
			personId: number;
			name: string;
			profilePath: string | null;
			roleBefore: string | null;
			roleAfter: string | null;
		}>
	).map(
		(link): PuzzleLink => ({
			personId: link.personId,
			name: link.name,
			profilePath: link.profilePath,
			...(link.roleBefore !== null || link.roleAfter !== null
				? { roles: [link.roleBefore ?? '', link.roleAfter ?? ''] as [string, string] }
				: {})
		})
	);
	return {
		id: row.id,
		...(row.name ? { name: row.name } : {}),
		start: hydrate(row.startMedia, row.startId),
		end: hydrate(row.endMedia, row.endId),
		chain,
		links,
		strikeLimit: row.strikeLimit,
		createdAt: new Date(row.createdAt).toISOString(),
		source: row.source === 'auto' ? 'auto' : 'manual'
	};
}

export function listPuzzles(): Puzzle[] {
	return (sql.listPuzzleIds.all() as Array<{ id: string }>)
		.map((row) => getPuzzle(row.id))
		.filter((puzzle): puzzle is Puzzle => puzzle !== null);
}

export const savePuzzle = db.transaction((puzzle: Puzzle) => {
	// Titles and people the puzzle points at must exist first — the puzzle
	// tables hold references, not copies.
	putTitles([puzzle.start, puzzle.end, ...puzzle.chain]);
	for (const link of puzzle.links) {
		sql.upsertPerson.run({
			personId: link.personId,
			name: link.name,
			profilePath: link.profilePath,
			popularity: 0
		});
	}

	// Replace rather than patch: cascade clears the chain and links.
	sql.deletePuzzle.run(puzzle.id);
	sql.insertPuzzle.run({
		id: puzzle.id,
		name: puzzle.name ?? null,
		startMedia: puzzle.start.mediaType,
		startId: puzzle.start.id,
		endMedia: puzzle.end.mediaType,
		endId: puzzle.end.id,
		strikeLimit: puzzle.strikeLimit ?? 3,
		source: puzzle.source ?? 'manual',
		createdAt: puzzle.createdAt ? Date.parse(puzzle.createdAt) || now() : now()
	});

	puzzle.chain.forEach((title, position) =>
		sql.insertChain.run({
			puzzleId: puzzle.id,
			position,
			mediaType: title.mediaType,
			id: title.id
		})
	);
	puzzle.links.forEach((link, position) =>
		sql.insertLink.run({
			puzzleId: puzzle.id,
			position,
			personId: link.personId,
			roleBefore: link.roles?.[0] ?? null,
			roleAfter: link.roles?.[1] ?? null
		})
	);
});

export function deletePuzzle(id: string): boolean {
	return sql.deletePuzzle.run(id).changes > 0;
}

/* -------------------------------------------------------------------------- */
/* Seed and export                                                            */
/* -------------------------------------------------------------------------- */

const SEED_PATH = 'src/lib/server/library.json';

/**
 * `library.json` is the seed shipped with the code: it's imported, so it's in
 * the bundle, and a fresh deployment comes up with puzzles in it. Once the
 * database has any puzzle of its own we leave it alone.
 */
function seedIfEmpty() {
	if (one(sql.count.puzzles) > 0) return;
	// Cast through `unknown`: the JSON's inferred shape can't narrow `roles` to a
	// two-element tuple, however well formed the file is.
	for (const puzzle of seed as unknown as Puzzle[]) savePuzzle(puzzle);
}

seedIfEmpty();

/**
 * Write the database's puzzles back out to the seed file, so puzzles authored
 * locally can be committed with the code. Dev only — in production the source
 * tree isn't ours to edit.
 */
export function exportSeed(): { path: string; puzzles: number } {
	if (!dev) throw new Error('The seed file can only be written in development.');
	const puzzles = listPuzzles();
	const path = resolve(process.cwd(), SEED_PATH);
	writeFileSync(path, JSON.stringify(puzzles, null, '\t') + '\n', 'utf8');
	return { path, puzzles: puzzles.length };
}
