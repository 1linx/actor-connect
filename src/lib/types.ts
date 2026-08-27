export type MediaType = 'movie' | 'tv';

/* -------------------------------------------------------------------------- */
/* TMDB-shaped basics (shared with the actor-search project)                  */
/* -------------------------------------------------------------------------- */

export interface TitleSummary {
	id: number;
	mediaType: MediaType;
	/** Films use `title`, shows use `name`; normalised to this. */
	title: string;
	/** Release year for films, first-air year for shows. */
	year: string | null;
	posterPath: string | null;
}

/**
 * A search result. Carries how many people have rated the title, which is the
 * best available measure of whether anyone has heard of it — shown in the
 * builder so an obscure match is obvious at a glance.
 *
 * Deliberately not part of `TitleSummary`: puzzles store titles, and a stored
 * puzzle shouldn't carry a vote count that was true on the day it was authored.
 */
export interface TitleSuggestion extends TitleSummary {
	voteCount?: number;
}

/** How a person is credited on one title. */
export interface CreditIn {
	/** Character name(s), collapsed where someone is credited more than once. */
	character: string;
	/** Billing order. Lower is higher billed; null means unbilled. */
	billing: number | null;
	/** Episodes appeared in. TV only — null for films. */
	episodes: number | null;
}

export interface SharedPerson {
	id: number;
	name: string;
	profilePath: string | null;
	/** TMDB's trending score. Breaks ties between similarly billed people. */
	popularity: number;
	inA: CreditIn;
	inB: CreditIn;
}

export interface SharedCastResult {
	a: TitleSummary;
	b: TitleSummary;
	cast: SharedPerson[];
	/** True when this answer needed no TMDB calls at all. */
	cached: boolean;
}

/** Wire format for a title reference, e.g. `movie:39513` or `tv:1396`. */
export const titleRef = (t: { mediaType: MediaType; id: number }) => `${t.mediaType}:${t.id}`;

/* -------------------------------------------------------------------------- */
/* Puzzles                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A puzzle is a chain: start → link → title → link → … → link → end.
 *
 * `chain` holds the titles the player has to place, in order. `links` holds the
 * people joining each consecutive pair, so there is always exactly one more
 * link than there are chain titles:
 *
 *   start ──links[0]── chain[0] ──links[1]── chain[1] ──links[2]── end
 *
 * Everything the game needs to render is stored here — poster paths, actor
 * names, profile paths — so playing a puzzle costs zero TMDB calls. Only
 * authoring one spends the API key.
 */
export interface PuzzleLink {
	personId: number;
	name: string;
	profilePath: string | null;
	/** Credited role either side of the link: `[in the earlier title, in the later one]`. */
	roles?: [string, string];
}

export interface Puzzle {
	id: string;
	/** Optional display name. Falls back to "Start → End". */
	name?: string;
	start: TitleSummary;
	end: TitleSummary;
	chain: TitleSummary[];
	links: PuzzleLink[];
	/** Strikes allowed. Three unless a puzzle says otherwise. */
	strikeLimit?: number;
	/** ISO date, set when saved. */
	createdAt?: string;
	/** How the puzzle came to exist. Phase two will write 'auto' here. */
	source?: 'manual' | 'auto';
}

/** What the browser is allowed to see: the chain answers and links are stripped. */
export interface PlayablePuzzle {
	id: string;
	name: string;
	start: TitleSummary;
	end: TitleSummary;
	/** How many titles the player must place. */
	slots: number;
	/** The chain titles, shuffled. Nothing in the deck is a wrong answer in
	 *  itself — every film belongs somewhere, the puzzle is working out where. */
	deck: TitleSummary[];
	strikeLimit: number;
}

/** One resolved connection, sent back only once it has been earned. */
export interface RevealedLink extends PuzzleLink {
	/** Index into the chain of links, 0 = the one leaving the start title. */
	index: number;
}

export interface GuessResult {
	correct: boolean;
	/** Links whose titles either side are now both known. */
	revealed: RevealedLink[];
	/** Present when the player has run out of strikes or given up. */
	solution?: SolvedPuzzle;
}

/** The full answer, handed over on a win, a loss, or a give-up. */
export interface SolvedPuzzle {
	chain: TitleSummary[];
	links: RevealedLink[];
}
