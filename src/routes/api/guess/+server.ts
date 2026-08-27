import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPuzzle, judgeGuess, placeableSlots } from '$lib/server/library';

/**
 * Mark one placement. No TMDB involved — everything needed was baked into the
 * puzzle when it was authored, so a whole game costs zero API calls.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as {
		puzzleId?: string;
		slot?: number;
		ref?: string;
		placed?: Record<string, string>;
		strikes?: number;
	} | null;

	if (!body?.puzzleId || typeof body.slot !== 'number' || typeof body.ref !== 'string') {
		return json({ error: 'Expected puzzleId, slot and ref.' }, { status: 400 });
	}

	const puzzle = getPuzzle(body.puzzleId);
	if (!puzzle) return json({ error: 'No such puzzle.' }, { status: 404 });

	const placed = body.placed ?? {};

	// A film can only go next to one we already know. Anything else is a bug or
	// a doctored request, and either way it isn't a wrong answer — no strike.
	const open = placeableSlots(puzzle, placed);
	if (!open.has(body.slot)) {
		const numbers = [...open].map((slot) => slot + 1);
		return json(
			{
				error: numbers.length
					? `That slot has no known neighbour yet. Open: ${numbers.join(', ')}.`
					: 'Every slot is already filled.'
			},
			{ status: 409 }
		);
	}

	const strikes = Number.isInteger(body.strikes) ? Math.max(0, body.strikes as number) : 0;
	return json(judgeGuess(puzzle, body.slot, body.ref, placed, strikes));
};
