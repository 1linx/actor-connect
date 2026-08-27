import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { databasePath } from './db';
import * as store from './store';
import {
	titleRef,
	type GuessResult,
	type PlayablePuzzle,
	type Puzzle,
	type RevealedLink,
	type SolvedPuzzle,
	type TitleSummary
} from '$lib/types';

/** Three strikes, per the brief, unless a puzzle asks for something else. */
export const STRIKE_LIMIT = 3;

/**
 * Puzzle rules, and the way in to the stored puzzle set.
 *
 * Persistence is [`store.ts`](./store.ts) — this file is the game's logic:
 * which placement is right, which connections that has earned, and what the
 * browser is allowed to know.
 */

export const listPuzzles = store.listPuzzles;
export const getPuzzle = store.getPuzzle;
export const savePuzzle = store.savePuzzle;
export const deletePuzzle = store.deletePuzzle;
export const stats = store.stats;
export const exportSeed = store.exportSeed;

/**
 * The builder, and the endpoints behind it, spend the TMDB key and edit the
 * puzzle set. Open in dev; closed in production unless deliberately opened.
 */
export const canEdit = () => dev || env.PUZZLE_EDITOR === '1';
export const canExportSeed = () => dev;
export const storeDescription = () => databasePath();

/** Picks the puzzle to serve when the URL doesn't name one. */
export function defaultPuzzle(): Puzzle | null {
	return store.listPuzzles()[0] ?? null;
}

export const puzzleName = (puzzle: Puzzle) =>
	puzzle.name || `${puzzle.start.title} → ${puzzle.end.title}`;

const strikeLimitOf = (puzzle: Puzzle) => puzzle.strikeLimit ?? STRIKE_LIMIT;

/* -------------------------------------------------------------------------- */
/* Playing                                                                    */
/* -------------------------------------------------------------------------- */

function shuffle<T>(items: T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * Strip a puzzle down to what the browser may see: the two ends, how many
 * slots there are, and a shuffled deck. The order of the chain and every
 * connecting actor stay on the server, so the answers aren't sitting in the
 * page source waiting to be read.
 */
export function toPlayable(puzzle: Puzzle): PlayablePuzzle {
	return {
		id: puzzle.id,
		name: puzzleName(puzzle),
		start: puzzle.start,
		end: puzzle.end,
		slots: puzzle.chain.length,
		deck: shuffle(puzzle.chain),
		strikeLimit: strikeLimitOf(puzzle)
	};
}

export function solutionOf(puzzle: Puzzle): SolvedPuzzle {
	return {
		chain: puzzle.chain,
		links: puzzle.links.map((link, index) => ({ ...link, index }))
	};
}

/**
 * The slots the client can *prove* it has filled.
 *
 * `placed` is the board as the client believes it to be, so every claim in it
 * is re-checked against the answer key before it counts anywhere.
 */
function validatedPlacements(puzzle: Puzzle, placed: Record<string, string>): Set<number> {
	const known = new Set<number>();
	for (const [key, value] of Object.entries(placed)) {
		const index = Number(key);
		const answer = Number.isInteger(index) ? puzzle.chain[index] : undefined;
		if (answer && titleRef(answer) === value) known.add(index);
	}
	return known;
}

/**
 * The slots a player may fill right now.
 *
 * A slot is open once it has a neighbour we already know, because that's what
 * makes a guess an informed one: the film going in has something to share an
 * actor *with*. Guessing a slot with two empty neighbours would be guessing
 * blind, so it isn't offered.
 *
 * The start and finish titles are given, so the two ends of the chain are open
 * from the off and the puzzle can be worked inwards from either — or from both,
 * meeting in the middle.
 */
export function placeableSlots(puzzle: Puzzle, placed: Record<string, string>): Set<number> {
	const known = validatedPlacements(puzzle, placed);
	const last = puzzle.chain.length - 1;

	const open = new Set<number>();
	for (let index = 0; index <= last; index++) {
		if (known.has(index)) continue;
		// index - 1 < 0 is the start title; index + 1 > last is the finish.
		const leftKnown = index === 0 || known.has(index - 1);
		const rightKnown = index === last || known.has(index + 1);
		if (leftKnown || rightKnown) open.add(index);
	}
	return open;
}

/**
 * Judge one placement. Assumes the slot is one `placeableSlots` allows — the
 * endpoint checks that first, since a blind placement isn't a wrong answer and
 * mustn't cost a strike.
 */
export function judgeGuess(
	puzzle: Puzzle,
	slot: number,
	ref: string,
	placed: Record<string, string>,
	strikes: number
): GuessResult {
	const correct = puzzle.chain[slot] !== undefined && titleRef(puzzle.chain[slot]) === ref;

	if (!correct) {
		const spent = strikes + 1;
		return {
			correct: false,
			revealed: [],
			...(spent >= strikeLimitOf(puzzle) ? { solution: solutionOf(puzzle) } : {})
		};
	}

	const known = validatedPlacements(puzzle, placed);
	known.add(slot);

	const filled = (index: number) => index < 0 || index >= puzzle.chain.length || known.has(index);

	const revealed: RevealedLink[] = [];
	puzzle.links.forEach((link, index) => {
		// Link `index` sits between chain slots index-1 and index. The start and
		// end titles are always on the board, hence the out-of-range pass.
		if (filled(index - 1) && filled(index)) revealed.push({ ...link, index });
	});

	const complete = known.size === puzzle.chain.length;
	return {
		correct: true,
		revealed,
		...(complete ? { solution: solutionOf(puzzle) } : {})
	};
}

/* -------------------------------------------------------------------------- */
/* Authoring                                                                  */
/* -------------------------------------------------------------------------- */

/** Sanity-check a puzzle posted by the builder before it goes in the database. */
export function parsePuzzle(body: unknown): Puzzle {
	const fail = (why: string): never => {
		throw new Error(why);
	};
	if (!body || typeof body !== 'object') fail('Expected a puzzle object.');
	const raw = body as Record<string, unknown>;

	const id = String(raw.id ?? '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	if (!id) fail('A puzzle needs an id.');

	const title = (value: unknown, where: string): TitleSummary => {
		const candidate = value as Partial<TitleSummary> | undefined;
		if (
			!candidate ||
			typeof candidate.id !== 'number' ||
			(candidate.mediaType !== 'movie' && candidate.mediaType !== 'tv')
		) {
			fail(`${where} is not a valid title.`);
		}
		return {
			id: candidate!.id as number,
			mediaType: candidate!.mediaType as 'movie' | 'tv',
			title: String(candidate!.title ?? 'Untitled'),
			year: candidate!.year ? String(candidate!.year) : null,
			posterPath: candidate!.posterPath ?? null
		};
	};

	const chain = (Array.isArray(raw.chain) ? raw.chain : fail('A puzzle needs a chain.')).map(
		(entry, i) => title(entry, `Chain title ${i + 1}`)
	);
	if (!chain.length) fail('A puzzle needs at least one title in the chain.');

	const links = (Array.isArray(raw.links) ? raw.links : fail('A puzzle needs links.')).map(
		(value, i) => {
			const link = value as Record<string, unknown>;
			if (!link || typeof link.personId !== 'number') fail(`Connection ${i + 1} has no person.`);
			return {
				personId: link.personId as number,
				name: String(link.name ?? 'Unknown'),
				profilePath: (link.profilePath as string | null) ?? null,
				...(Array.isArray(link.roles) && link.roles.length === 2
					? { roles: [String(link.roles[0]), String(link.roles[1])] as [string, string] }
					: {})
			};
		}
	);
	if (links.length !== chain.length + 1) {
		fail(
			`Expected ${chain.length + 1} connections for ${chain.length} chain titles, got ${links.length}.`
		);
	}

	const start = title(raw.start, 'The start title');
	const end = title(raw.end, 'The end title');
	// The same film twice would be right in two places at once.
	if (new Set(chain.map(titleRef)).size !== chain.length) {
		fail('The same title appears twice in the chain.');
	}

	return {
		id,
		...(raw.name ? { name: String(raw.name) } : {}),
		start,
		end,
		chain,
		links,
		strikeLimit: STRIKE_LIMIT,
		createdAt: new Date().toISOString(),
		source: 'manual'
	};
}
