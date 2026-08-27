import type { PageServerLoad } from './$types';
import { canExportSeed, listPuzzles, puzzleName, stats, storeDescription } from '$lib/server/library';

export const load: PageServerLoad = () => ({
	store: storeDescription(),
	stats: stats(),
	canExportSeed: canExportSeed(),
	puzzles: listPuzzles().map((puzzle) => ({
		id: puzzle.id,
		name: puzzleName(puzzle),
		slots: puzzle.chain.length,
		source: puzzle.source ?? 'manual'
	}))
});
