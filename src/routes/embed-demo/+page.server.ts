import type { PageServerLoad } from './$types';
import { listPuzzles, puzzleName } from '$lib/server/library';

export const load: PageServerLoad = () => ({
	puzzles: listPuzzles().map((p) => ({ id: p.id, name: puzzleName(p) }))
});
