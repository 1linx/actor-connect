import type { PageServerLoad } from './$types';
import {
	canExportSeed,
	getPuzzle,
	listPuzzles,
	puzzleName,
	stats,
	storeDescription
} from '$lib/server/library';

export const load: PageServerLoad = ({ url }) => {
	// `?edit=<id>` loads an existing puzzle back into the form. The whole puzzle
	// is sent, links included, so the connections it was saved with can be
	// pre-selected rather than re-guessed from billing order.
	const wanted = url.searchParams.get('edit');
	const editing = wanted ? getPuzzle(wanted) : null;

	return {
		store: storeDescription(),
		stats: stats(),
		canExportSeed: canExportSeed(),
		editing,
		missing: wanted && !editing ? wanted : null,
		puzzles: listPuzzles().map((puzzle) => ({
			id: puzzle.id,
			name: puzzleName(puzzle),
			slots: puzzle.chain.length,
			source: puzzle.source ?? 'manual'
		}))
	};
};
