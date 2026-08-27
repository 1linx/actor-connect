import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	canExportSeed,
	deletePuzzle,
	exportSeed,
	listPuzzles,
	parsePuzzle,
	puzzleName,
	savePuzzle,
	stats,
	storeDescription
} from '$lib/server/library';

export const GET: RequestHandler = async () =>
	json({
		store: storeDescription(),
		stats: stats(),
		puzzles: listPuzzles().map((puzzle) => ({
			id: puzzle.id,
			name: puzzleName(puzzle),
			slots: puzzle.chain.length,
			source: puzzle.source ?? 'manual',
			createdAt: puzzle.createdAt ?? null
		}))
	});

export const POST: RequestHandler = async ({ request }) => {
	try {
		const puzzle = parsePuzzle(await request.json());
		savePuzzle(puzzle);
		return json({ saved: puzzle.id });
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 400 });
	}
};

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'Expected ?id=' }, { status: 400 });
	if (!deletePuzzle(id)) return json({ error: 'No such puzzle.' }, { status: 404 });
	return json({ deleted: id });
};

/**
 * Write the database's puzzles back out to `library.json`, which is the seed
 * shipped with the code — this is how a locally authored puzzle gets committed.
 */
export const PUT: RequestHandler = async () => {
	if (!canExportSeed()) {
		return json({ error: 'The seed file can only be written in development.' }, { status: 403 });
	}
	try {
		return json(exportSeed());
	} catch (err) {
		return json({ error: (err as Error).message }, { status: 500 });
	}
};
