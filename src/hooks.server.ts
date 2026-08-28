import type { Handle } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { canEdit } from '$lib/server/library';

/**
 * Routes that spend the TMDB key or write the library. Open in `vite dev`,
 * closed in production unless PUZZLE_EDITOR=1 — otherwise anyone who found the
 * URL could run up API calls on our key, or edit the puzzle set.
 */
const EDITOR_ONLY = [
	'/build',
	'/api/search',
	'/api/links',
	'/api/puzzles',
	'/api/cast',
	'/api/filmography'
];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	if (EDITOR_ONLY.some((prefix) => path === prefix || path.startsWith(prefix + '/')) && !canEdit()) {
		error(404, 'Not found');
	}

	const embed = event.url.searchParams.has('embed');
	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('%actorconnect.body%', embed ? 'embed' : '')
	});

	// The point of the app is to be iframed by the Laravel side, so don't let
	// the framework's default deny us. Lock this down to your own host in
	// production if the game ever carries anything worth clickjacking.
	response.headers.delete('x-frame-options');
	return response;
};
