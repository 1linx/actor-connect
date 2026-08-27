const BASE = 'https://image.tmdb.org/t/p';

/** TMDB serves images straight from its CDN, so these cost us no API calls. */
export const posterUrl = (path: string | null, size = 'w185') =>
	path ? `${BASE}/${size}${path}` : null;

export const profileUrl = (path: string | null, size = 'w185') =>
	path ? `${BASE}/${size}${path}` : null;
