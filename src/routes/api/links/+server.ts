import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TmdbError, compareTitles } from '$lib/server/tmdb';
import type { MediaType } from '$lib/types';

/** Parses a `movie:39513` / `tv:1396` reference. */
function parseRef(value: string | null): { mediaType: MediaType; id: number } | null {
	const match = /^(movie|tv):(\d+)$/.exec(value ?? '');
	if (!match) return null;
	const id = Number(match[2]);
	return id > 0 ? { mediaType: match[1] as MediaType, id } : null;
}

/**
 * Everyone two titles have in common — the candidate connections for one link
 * in a chain. Builder-only. Two API calls the first time either title is
 * involved, none after that.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const a = parseRef(url.searchParams.get('a'));
	const b = parseRef(url.searchParams.get('b'));

	if (!a || !b) {
		return json(
			{ error: 'Two title references are required, e.g. ?a=movie:1701&b=movie:9802' },
			{ status: 400 }
		);
	}
	if (a.mediaType === b.mediaType && a.id === b.id) {
		return json({ error: 'Those are the same title.' }, { status: 400 });
	}

	try {
		const result = await compareTitles(a, b);
		setHeaders({ 'cache-control': 'private, max-age=86400' });
		return json(result);
	} catch (err) {
		const status = err instanceof TmdbError ? err.status : 502;
		return json({ error: (err as Error).message }, { status });
	}
};
