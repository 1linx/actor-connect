import type { PageServerLoad } from './$types';
import { stats } from '$lib/server/library';

export const load: PageServerLoad = () => ({ stats: stats() });
