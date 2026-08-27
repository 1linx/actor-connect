/**
 * In-flight request coalescing.
 *
 * SQLite is the actual cache — it's durable, so nothing needs a TTL held in
 * memory. What a database can't do is stop two simultaneous requests for the
 * same uncached thing from both going out to TMDB, which is exactly what a
 * debounced search box or a double-clicked button produces. This collapses
 * them into one call whose result both callers await.
 */
export class SingleFlight<T> {
	#pending = new Map<string, Promise<T>>();

	run(key: string, load: () => Promise<T>): Promise<T> {
		const existing = this.#pending.get(key);
		if (existing) return existing;

		const promise = load().finally(() => this.#pending.delete(key));
		this.#pending.set(key, promise);
		return promise;
	}

	get inFlight() {
		return this.#pending.size;
	}
}

/**
 * Keeps our outbound rate civil: at most `maxConcurrent` requests at once, and
 * at least `minGapMs` between starts. TMDB is generous about limits, but a
 * batch job that generates puzzles shouldn't be able to burst hundreds of
 * requests at them in a second either.
 */
export class Throttle {
	#active = 0;
	#lastStart = 0;
	#waiting: Array<() => void> = [];

	constructor(
		private maxConcurrent: number,
		private minGapMs: number
	) {}

	async run<T>(fn: () => Promise<T>): Promise<T> {
		await this.#acquire();
		try {
			return await fn();
		} finally {
			this.#active--;
			this.#waiting.shift()?.();
		}
	}

	async #acquire() {
		while (this.#active >= this.maxConcurrent) {
			await new Promise<void>((resolve) => this.#waiting.push(resolve));
		}
		this.#active++;

		const gap = this.minGapMs - (Date.now() - this.#lastStart);
		if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
		this.#lastStart = Date.now();
	}
}
