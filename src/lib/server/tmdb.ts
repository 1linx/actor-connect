import { env } from '$env/dynamic/private';
import { SingleFlight, Throttle } from './cache';
import * as store from './store';
import type { MediaType, SharedCastResult, TitleSuggestion, TitleSummary } from '$lib/types';

const BASE = 'https://api.themoviedb.org/3';

/**
 * How long a cached answer stands before we'd ask TMDB again.
 *
 * A released film's cast is history and never changes, so we effectively never
 * re-ask. A series can gain a season, so its cast is worth a look every couple
 * of weeks. Searches expire slowly — a new film matching an old query is the
 * only thing that changes.
 *
 * Nothing here expires while a puzzle is being played; puzzles carry their own
 * copy of everything they need.
 */
const TTL = {
	movieCast: 365 * 24 * 60 * 60 * 1000,
	tvCast: 14 * 24 * 60 * 60 * 1000,
	search: 30 * 24 * 60 * 60 * 1000,
	filmography: 30 * 24 * 60 * 60 * 1000
};

/** At most four requests in flight, 50ms apart. */
const throttle = new Throttle(4, 50);
const searchFlight = new SingleFlight<store.SearchCandidate[]>();
const castFlight = new SingleFlight<void>();

export class TmdbError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

type Credentials = { bearer: string } | { apiKey: string };

/**
 * TMDB accepts either a v3 API key (32 hex chars, as a query param) or a v4
 * read access token (a JWT, as a Bearer header). Work out which we were given
 * so either value in TMDB_API_KEY just works.
 */
function credentials(): Credentials {
	const raw = (env.TMDB_READ_ACCESS_TOKEN || env.TMDB_API_KEY || '').trim();
	if (!raw) {
		throw new TmdbError('TMDB_API_KEY is not set. Copy .env.example to .env and add your key.', 500);
	}
	return raw.split('.').length === 3 ? { bearer: raw } : { apiKey: raw };
}

/**
 * The only place in the app that talks to TMDB. Every call is throttled and
 * recorded in `api_calls`, so the traffic we generate is auditable rather than
 * a matter of trust — see the counts on /build.
 */
async function request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
	const creds = credentials();
	const url = new URL(BASE + path);
	url.searchParams.set('language', 'en-US');
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	if ('apiKey' in creds) url.searchParams.set('api_key', creds.apiKey);

	return throttle.run(async () => {
		const started = Date.now();
		let status: number | null = null;
		try {
			const res = await fetch(url, {
				headers: {
					accept: 'application/json',
					...('bearer' in creds ? { authorization: `Bearer ${creds.bearer}` } : {})
				}
			});
			status = res.status;

			if (!res.ok) {
				const detail = await res
					.json()
					.then((body) => (body as { status_message?: string }).status_message)
					.catch(() => null);
				throw new TmdbError(detail ?? `TMDB request failed (${res.status})`, res.status);
			}
			return (await res.json()) as T;
		} finally {
			store.logCall(path, status, Date.now() - started);
		}
	});
}

/* -------------------------------------------------------------------------- */
/* Shapes TMDB returns                                                        */
/* -------------------------------------------------------------------------- */

interface TmdbTitle {
	id: number;
	media_type?: string;
	title?: string;
	name?: string;
	release_date?: string;
	first_air_date?: string;
	poster_path?: string | null;
	popularity?: number;
	vote_count?: number;
	vote_average?: number;
}

interface TmdbMovieCredit {
	id: number;
	name: string;
	profile_path?: string | null;
	character?: string;
	order?: number;
	popularity?: number;
}

/** Aggregate TV credits nest the roles, since a person can recur or double up. */
interface TmdbTvCredit {
	id: number;
	name: string;
	profile_path?: string | null;
	roles?: Array<{ character?: string; episode_count?: number }>;
	total_episode_count?: number;
	order?: number;
	popularity?: number;
}

const year = (date?: string) => (date ? date.slice(0, 4) : null) || null;

/** Films and shows use different field names for the same two things. */
function normalise(raw: TmdbTitle, mediaType: MediaType): TitleSummary {
	return {
		id: raw.id,
		mediaType,
		title: (mediaType === 'movie' ? raw.title : raw.name) ?? 'Untitled',
		year: year(mediaType === 'movie' ? raw.release_date : raw.first_air_date),
		posterPath: raw.poster_path ?? null
	};
}

const withFame = (raw: TmdbTitle, mediaType: MediaType): store.SearchCandidate => ({
	...normalise(raw, mediaType),
	popularity: raw.popularity ?? 0,
	voteCount: raw.vote_count ?? 0,
	voteAverage: raw.vote_average ?? 0
});

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

/** Split into lowercase words, ignoring punctuation. */
const words = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean);

/** Words too common to tell us anything about which title was meant. */
const NOISE = new Set(['the', 'a', 'an', 'of', 'and', 'part']);

/**
 * Does the title account for every meaningful word in the query?
 *
 * Prefix matching, because this runs against a box someone is still typing in:
 * "jurass" should match Jurassic Park. TMDB happily returns fuzzy matches that
 * share no words at all with the query — "Caution to the Wind" for "con air" —
 * and this is what sorts those below everything that genuinely matches.
 */
function coversQuery(queryWords: string[], titleWords: string[]): boolean {
	return queryWords.every((wanted) => titleWords.some((word) => word.startsWith(wanted)));
}

/**
 * Re-rank a search response so recognisable titles come first.
 *
 * The ordering is two-level. First, whether the title accounts for what was
 * typed — anything that does beats anything that doesn't, so searching for
 * something obscure by name still finds it. Then, within each group, fame.
 *
 * `vote_count` is the fame signal that works: it's a count of humans, and it's
 * log-scaled because the gap between 8 votes and 800 matters far more than the
 * gap between 8,000 and 20,000. TMDB's `popularity` is a light nudge only — it
 * measures this week's page views, and a four-vote stand-up special can
 * out-popularity Heat. TMDB's own result order stays in as `-position`, since
 * it carries relevance we can't reconstruct.
 *
 * An exact title match gets a firm bonus rather than its own tier: enough that
 * typing "the rock" beats the better-rated School of Rock, not enough that a
 * one-vote TV movie called HEAT outranks Red Heat.
 */
function rankByFame(
	query: string,
	candidates: store.SearchCandidate[],
	limit: number
): TitleSuggestion[] {
	const all = words(query);
	const meaningful = all.filter((word) => !NOISE.has(word));
	// A query that is nothing but noise words still has to match on something.
	const queryWords = meaningful.length ? meaningful : all;
	const flat = queryWords.join(' ');

	return candidates
		.map((candidate, position) => {
			const titleWords = words(candidate.title);
			const exact = titleWords.filter((word) => !NOISE.has(word)).join(' ') === flat;

			return {
				candidate,
				covers: coversQuery(queryWords, titleWords),
				score:
					3 * Math.log10(candidate.voteCount + 1) +
					Math.log10(candidate.popularity + 1) -
					0.35 * position +
					(exact ? 4 : 0)
			};
		})
		.sort((a, b) => Number(b.covers) - Number(a.covers) || b.score - a.score)
		.slice(0, limit)
		.map(({ candidate }) => ({
			id: candidate.id,
			mediaType: candidate.mediaType,
			title: candidate.title,
			year: candidate.year,
			posterPath: candidate.posterPath,
			voteCount: candidate.voteCount
		}));
}

/**
 * One `/search/multi` call covers films and shows together, which beats
 * querying `/search/movie` and `/search/tv` separately. It also returns
 * people, which we drop.
 *
 * The whole page of 20 results is kept and ranked, and only then cut to
 * `limit` — the good match sitting at position 12 is exactly what this is for.
 */
export function searchTitles(query: string, limit = 8): Promise<TitleSuggestion[]> {
	const normalised = query.trim().toLowerCase();

	const cached = store.getSearch(normalised, TTL.search);
	if (cached) return Promise.resolve(rankByFame(normalised, cached, limit));

	return searchFlight
		.run(normalised, async () => {
			const data = await request<{ results?: TmdbTitle[] }>('/search/multi', {
				query: normalised,
				include_adult: 'false',
				page: '1'
			});
			const candidates = (data.results ?? [])
				.filter(
					(result): result is TmdbTitle & { media_type: MediaType } =>
						result.media_type === 'movie' || result.media_type === 'tv'
				)
				.map((result) => withFame(result, result.media_type));

			// Stored in TMDB's order, not ours, so that changing the ranking
			// takes effect on cached queries too.
			store.putSearch(normalised, candidates);
			return candidates;
		})
		.then((candidates) => rankByFame(normalised, candidates, limit));
}

/* -------------------------------------------------------------------------- */
/* Cast                                                                       */
/* -------------------------------------------------------------------------- */

/** Merge repeat credits for one person on one title into a single entry. */
function collapse(
	entries: Array<{
		id: number;
		name: string;
		profilePath: string | null;
		character: string;
		billing: number | null;
		episodes: number | null;
		popularity: number;
	}>
): store.CastEntry[] {
	const merged = new Map<number, store.CastEntry>();

	for (const entry of entries) {
		const existing = merged.get(entry.id);
		if (!existing) {
			merged.set(entry.id, {
				personId: entry.id,
				name: entry.name,
				profilePath: entry.profilePath,
				character: entry.character,
				billing: entry.billing,
				episodes: entry.episodes,
				popularity: entry.popularity
			});
			continue;
		}
		if (entry.character && !existing.character.split(' / ').includes(entry.character)) {
			existing.character = existing.character
				? `${existing.character} / ${entry.character}`
				: entry.character;
		}
		if (entry.billing !== null) {
			existing.billing =
				existing.billing === null ? entry.billing : Math.min(existing.billing, entry.billing);
		}
		if (entry.episodes !== null) existing.episodes = (existing.episodes ?? 0) + entry.episodes;
	}

	return [...merged.values()];
}

/**
 * Make sure we hold this title's cast locally, fetching it only if we don't
 * already have it (or, for a series, if what we have has had time to go stale).
 *
 * Films use `credits`; shows use `aggregate_credits`, which covers the whole
 * run rather than only the latest season.
 */
async function ensureCast(mediaType: MediaType, id: number): Promise<void> {
	const fetched = store.castFetchedAt(mediaType, id);
	const ttl = mediaType === 'movie' ? TTL.movieCast : TTL.tvCast;
	if (fetched !== null && Date.now() - fetched < ttl) return;

	return castFlight.run(`${mediaType}:${id}`, async () => {
		if (mediaType === 'movie') {
			const raw = await request<TmdbTitle & { credits?: { cast?: TmdbMovieCredit[] } }>(
				`/movie/${id}`,
				{ append_to_response: 'credits' }
			);
			const film = withFame(raw, 'movie');
			store.putCast(
				film,
				collapse(
					(raw.credits?.cast ?? []).map((credit) => ({
						id: credit.id,
						name: credit.name,
						profilePath: credit.profile_path ?? null,
						character: (credit.character ?? '').trim(),
						billing: credit.order ?? null,
						// Films have no episodes.
						episodes: null,
						popularity: credit.popularity ?? 0
					}))
				),
				{
					popularity: film.popularity,
					voteCount: film.voteCount,
					voteAverage: film.voteAverage
				}
			);
			return;
		}

		const raw = await request<TmdbTitle & { aggregate_credits?: { cast?: TmdbTvCredit[] } }>(
			`/tv/${id}`,
			{ append_to_response: 'aggregate_credits' }
		);
		const show = withFame(raw, 'tv');
		store.putCast(
			show,
			collapse(
				(raw.aggregate_credits?.cast ?? []).map((credit) => ({
					id: credit.id,
					name: credit.name,
					profilePath: credit.profile_path ?? null,
					character: (credit.roles ?? [])
						.map((role) => (role.character ?? '').trim())
						.filter(Boolean)
						.join(' / '),
					billing: credit.order ?? null,
					episodes:
						credit.total_episode_count ??
						(credit.roles ?? []).reduce((sum, role) => sum + (role.episode_count ?? 0), 0) ??
						null,
					popularity: credit.popularity ?? 0
				}))
			),
			{
				popularity: show.popularity,
				voteCount: show.voteCount,
				voteAverage: show.voteAverage
			}
		);
	});
}

/**
 * A person's film credits, as `/person/{id}/movie_credits` returns them. One
 * call gives their whole filmography, which is what makes walking the cast
 * graph cheap: a film costs one call, an actor costs one call, and neither is
 * ever paid twice.
 */
interface TmdbPersonCredit extends TmdbTitle {
	character?: string;
	order?: number;
}

const personFlight = new SingleFlight<void>();

async function ensurePersonCredits(personId: number): Promise<void> {
	const fetched = store.personCreditsFetchedAt(personId);
	// Filmographies grow, unlike a released film's cast, so this one expires.
	if (fetched !== null && Date.now() - fetched < TTL.filmography) return;

	return personFlight.run(String(personId), async () => {
		const raw = await request<{
			id: number;
			name?: string;
			profile_path?: string | null;
			popularity?: number;
			cast?: TmdbPersonCredit[];
		}>(`/person/${personId}/movie_credits`, {});

		// The credits endpoint doesn't return the person's own name, so keep
		// whatever the cast list that led us here already told us.
		const known = store.getPerson(personId);

		store.putPersonCredits(
			{
				personId,
				name: known?.name ?? raw.name ?? 'Unknown',
				profilePath: known?.profilePath ?? raw.profile_path ?? null,
				popularity: known?.popularity ?? raw.popularity ?? 0
			},
			(raw.cast ?? []).map((credit) => {
				const summary = withFame(credit, 'movie');
				return {
					title: {
						id: summary.id,
						mediaType: summary.mediaType,
						title: summary.title,
						year: summary.year,
						posterPath: summary.posterPath
					},
					fame: {
						popularity: summary.popularity,
						voteCount: summary.voteCount,
						voteAverage: summary.voteAverage
					},
					character: (credit.character ?? '').trim(),
					billing: credit.order ?? null
				};
			})
		);
	});
}

/**
 * The cast of one title, filtered to people worth building a puzzle around.
 * One API call the first time, none after.
 */
export async function castFor(
	title: { mediaType: MediaType; id: number },
	options: { minPopularity?: number; limit?: number } = {}
): Promise<{ title: TitleSummary; cast: store.CastMember[]; cached: boolean }> {
	const before = store.stats().calls.total;
	await ensureCast(title.mediaType, title.id);

	return {
		title: store.getTitle(title.mediaType, title.id) ?? normalise({ id: title.id }, title.mediaType),
		cast: store.castOf(title.mediaType, title.id, options),
		cached: store.stats().calls.total === before
	};
}

/** One person's films, filtered to ones people have heard of. */
export async function filmographyFor(
	personId: number,
	options: { minVotes?: number; limit?: number } = {}
): Promise<{
	person: { personId: number; name: string; profilePath: string | null; popularity: number } | null;
	films: store.FilmographyEntry[];
	cached: boolean;
}> {
	const before = store.stats().calls.total;
	await ensurePersonCredits(personId);

	return {
		person: store.getPerson(personId),
		films: store.filmographyOf(personId, options),
		cached: store.stats().calls.total === before
	};
}

/** A title's summary, from the cache if we have it. */
export async function getTitleSummary(mediaType: MediaType, id: number): Promise<TitleSummary> {
	const known = store.getTitle(mediaType, id);
	if (known) return known;
	await ensureCast(mediaType, id);
	return store.getTitle(mediaType, id) ?? normalise({ id }, mediaType);
}

/**
 * Everyone two titles have in common — the candidate connections for one link
 * in a chain.
 *
 * Costs at most two API calls the first time a title is involved, and none
 * thereafter: the intersection itself is a SQLite join over cast we already
 * hold.
 */
export async function compareTitles(
	a: { mediaType: MediaType; id: number },
	b: { mediaType: MediaType; id: number }
): Promise<SharedCastResult> {
	const before = store.stats().calls.total;

	await Promise.all([ensureCast(a.mediaType, a.id), ensureCast(b.mediaType, b.id)]);

	const summary = (t: { mediaType: MediaType; id: number }) =>
		store.getTitle(t.mediaType, t.id) ?? normalise({ id: t.id }, t.mediaType);

	return {
		a: summary(a),
		b: summary(b),
		cast: store.sharedCast(a, b),
		cached: store.stats().calls.total === before
	};
}
