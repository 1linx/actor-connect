import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TmdbError, filmographyFor } from '$lib/server/tmdb';

/**
 * One person's films, for the walk builder. `fame` is a floor on the number of
 * ratings a film has, which is the signal that separates films people have
 * heard of from the long tail of shorts and documentaries.
 *
 * Builder-only. One TMDB call per person, ever.
 */
export const GET: RequestHandler = async ({ url, setHeaders }) => {
	const personId = Number(url.searchParams.get('person'));
	if (!Number.isInteger(personId) || personId <= 0) {
		return json({ error: 'Expected ?person=2963' }, { status: 400 });
	}

	const minVotes = Math.max(0, Number(url.searchParams.get('fame') ?? 0) || 0);
	const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit') ?? 40) || 40));

	try {
		const result = await filmographyFor(personId, { minVotes, limit });
		if (!result.person) return json({ error: 'No such person.' }, { status: 404 });
		setHeaders({ 'cache-control': 'private, max-age=86400' });
		return json(result);
	} catch (err) {
		const status = err instanceof TmdbError ? err.status : 502;
		return json({ error: (err as Error).message }, { status });
	}
};
