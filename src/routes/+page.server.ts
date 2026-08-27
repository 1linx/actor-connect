import type { PageServerLoad } from './$types';
import { canEdit, defaultPuzzle, getPuzzle, listPuzzles, puzzleName, toPlayable } from '$lib/server/library';

export const load: PageServerLoad = ({ url }) => {
	const requested = url.searchParams.get('puzzle');
	const puzzle = requested ? getPuzzle(requested) : defaultPuzzle();

	return {
		// Answers are stripped here, not in the browser.
		playable: puzzle ? toPlayable(puzzle) : null,
		missing: requested && !puzzle ? requested : null,
		index: listPuzzles().map((p) => ({ id: p.id, name: puzzleName(p) })),
		canEdit: canEdit()
	};
};
