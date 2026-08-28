import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TmdbError, castFor } from '$lib/server/tmdb';
import type { MediaType } from '$lib/types';

/** Parses a `movie:1701` / `tv:1396` reference. */
function parseRef(value: string | null): { mediaType: MediaType; id: number } | null {
	const match = /^(movie|tv):(\d+)$/.exec(value ?? '');
	if (!match) return null;
	const id = Number(match[2]);
	return id > 0 ? { mediaType: match[1] as MediaType, id } : null;
}

/**
 * The cast of one title, for the walk builder. `fame` is a floor on TMDB's
 * person popularity, which is what keeps a 60-name cast list down to the
 * faces a player might actually recognise.
 *
 * Builder-only. One TMDB call the first time a title comes up, none after.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const ref = parseRef(url.searchParams.get('ref'));
	if (!ref) return json({ error: 'Expected ?ref=movie:1701' }, { status: 400 });

	const minPopularity = Math.max(0, Number(url.searchParams.get('fame') ?? 0) || 0);
	const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit') ?? 40) || 40));

	try {
		const result = await castFor(ref, { minPopularity, limit });
		setHeaders({ 'cache-control': 'private, max-age=86400' });
		return json(result);
	} catch (err) {
		const status = err instanceof TmdbError ? err.status : 502;
		return json({ error: (err as Error).message }, { status });
	}
};
