import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TmdbError, searchTitles } from '$lib/server/tmdb';

/** Builder-only: spends a TMDB call, so hooks.server.ts gates it. */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const query = (url.searchParams.get('q') ?? '').trim();

	// Nothing useful comes back from a one-character query, so don't spend a call.
	if (query.length < 2) return json({ results: [] });

	try {
		const results = await searchTitles(query);
		setHeaders({ 'cache-control': 'private, max-age=3600' });
		return json({ results });
	} catch (err) {
		const status = err instanceof TmdbError ? err.status : 502;
		return json({ error: (err as Error).message, results: [] }, { status });
	}
};
