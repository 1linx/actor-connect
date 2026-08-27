import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPuzzle, solutionOf } from '$lib/server/library';

/** The whole chain, for a player who has given up. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { puzzleId?: string } | null;
	if (!body?.puzzleId) return json({ error: 'Expected a puzzleId.' }, { status: 400 });

	const puzzle = getPuzzle(body.puzzleId);
	if (!puzzle) return json({ error: 'No such puzzle.' }, { status: 404 });

	return json(solutionOf(puzzle));
};
