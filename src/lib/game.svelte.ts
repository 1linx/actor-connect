import {
	titleRef,
	type GuessResult,
	type PlayablePuzzle,
	type Puzzle,
	type PuzzleLink,
	type SolvedPuzzle,
	type TitleSummary
} from './types';

export interface Attempt {
	slot: number;
	ref: string;
	/** The board as it stands, slot index → title ref. */
	placed: Record<number, string>;
	strikes: number;
}

/** How a guess gets marked. Swappable so a host page can supply its own puzzle. */
export type Judge = (attempt: Attempt) => Promise<GuessResult>;
export type Revealer = () => Promise<SolvedPuzzle>;

export type Status = 'playing' | 'won' | 'lost' | 'revealed';

function shuffle<T>(items: T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/**
 * Strip a puzzle handed in by a host page down to a playable board, mirroring
 * what the server does for library puzzles.
 */
export function playableFrom(puzzle: Puzzle, strikeLimit = 3): PlayablePuzzle {
	return {
		id: puzzle.id,
		name: puzzle.name || `${puzzle.start.title} → ${puzzle.end.title}`,
		start: puzzle.start,
		end: puzzle.end,
		slots: puzzle.chain.length,
		deck: shuffle(puzzle.chain),
		strikeLimit
	};
}

/**
 * A single playthrough.
 *
 * The engine holds no answers — it asks the `judge` whether a placement is
 * right and is told which connections that has earned. The default judge is a
 * server round trip, which is what keeps the cast list out of the page source;
 * an embedded host that supplies its own puzzle gets `localJudge` instead.
 */
export class Game {
	readonly puzzle: PlayablePuzzle;
	#judge: Judge;
	#reveal: Revealer;

	/** Slot index → the title placed there. Only ever correct placements. */
	placed = $state<Record<number, TitleSummary>>({});
	/** Link index → the connecting person, once earned. */
	links = $state<Record<number, PuzzleLink>>({});
	/** The deck, minus what has been placed. Shuffled by the server. */
	deck = $state<TitleSummary[]>([]);
	strikes = $state(0);
	/** The full answer — arrives on a win, on a third strike, or on a give-up. */
	solution = $state<SolvedPuzzle | null>(null);
	gaveUp = $state(false);
	busy = $state(false);
	error = $state<string | null>(null);
	/** Slot to shake, cleared once the animation has run. */
	wrongSlot = $state<number | null>(null);
	/** Links revealed by the last placement, so they can animate in. */
	fresh = $state<number[]>([]);
	startedAt = Date.now();
	finishedAt = $state<number | null>(null);

	constructor(puzzle: PlayablePuzzle, judge: Judge, reveal: Revealer) {
		this.puzzle = puzzle;
		this.#judge = judge;
		this.#reveal = reveal;
		this.deck = [...puzzle.deck];
	}

	// `.by` throughout: a plain `$derived` referencing `this.puzzle` would read a
	// field the constructor hasn't assigned yet, which TypeScript rightly flags.
	placedCount = $derived(Object.keys(this.placed).length);
	solved = $derived.by(() => this.placedCount === this.puzzle.slots);
	failed = $derived.by(() => this.strikes >= this.puzzle.strikeLimit);
	over = $derived.by(() => this.solved || this.failed || this.gaveUp);
	strikesLeft = $derived.by(() => Math.max(0, this.puzzle.strikeLimit - this.strikes));

	status: Status = $derived(
		this.solved ? 'won' : this.failed ? 'lost' : this.gaveUp ? 'revealed' : 'playing'
	);

	/**
	 * The slots that can be filled right now: those with a neighbour already
	 * known, so the film going in has something to share an actor with. Both
	 * ends of the chain start out open, since the two anchor titles are given.
	 */
	openSlots = $derived.by(() => {
		const last = this.puzzle.slots - 1;
		const open = new Set<number>();
		for (let index = 0; index <= last; index++) {
			if (this.placed[index]) continue;
			const leftKnown = index === 0 || Boolean(this.placed[index - 1]);
			const rightKnown = index === last || Boolean(this.placed[index + 1]);
			if (leftKnown || rightKnown) open.add(index);
		}
		return open;
	});

	/** Cards still to play, in deck order. */
	hand = $derived.by(() => {
		const used = new Set(Object.values(this.placed).map(titleRef));
		return this.deck.filter((t) => !used.has(titleRef(t)));
	});

	get refs(): Record<number, string> {
		return Object.fromEntries(
			Object.entries(this.placed).map(([slot, title]) => [slot, titleRef(title)])
		);
	}

	/** Is this link's connection known? */
	linkAt(index: number): PuzzleLink | null {
		return this.links[index] ?? this.solution?.links.find((l) => l.index === index) ?? null;
	}

	/** The title shown at a slot: what the player placed, or the answer once over. */
	slotAt(index: number): { title: TitleSummary; earned: boolean } | null {
		const mine = this.placed[index];
		if (mine) return { title: mine, earned: true };
		const answer = this.solution?.chain[index];
		return answer ? { title: answer, earned: false } : null;
	}

	async place(slot: number, title: TitleSummary) {
		if (this.busy || this.over || this.placed[slot]) return;
		// The UI only offers open slots; this is the belt to that braces.
		if (!this.openSlots.has(slot)) return;

		this.busy = true;
		this.error = null;
		try {
			const result = await this.#judge({
				slot,
				ref: titleRef(title),
				placed: this.refs,
				strikes: this.strikes
			});

			if (result.correct) {
				this.placed = { ...this.placed, [slot]: title };
				const fresh = result.revealed.filter((link) => !(link.index in this.links));
				this.links = {
					...this.links,
					...Object.fromEntries(result.revealed.map((link) => [link.index, link]))
				};
				this.fresh = fresh.map((link) => link.index);
			} else {
				this.strikes += 1;
				this.wrongSlot = slot;
				this.fresh = [];
				setTimeout(() => {
					if (this.wrongSlot === slot) this.wrongSlot = null;
				}, 450);
			}

			if (result.solution) this.solution = result.solution;
			if (this.over) this.finishedAt = Date.now();
		} catch (e) {
			this.error = (e as Error).message || 'Something went wrong marking that.';
		} finally {
			this.busy = false;
		}
	}

	async giveUp() {
		if (this.busy || this.over) return;
		this.busy = true;
		try {
			this.solution = await this.#reveal();
			this.gaveUp = true;
			this.finishedAt = Date.now();
		} catch (e) {
			this.error = (e as Error).message || 'Could not fetch the answer.';
		} finally {
			this.busy = false;
		}
	}

	restart() {
		this.placed = {};
		this.links = {};
		this.strikes = 0;
		this.solution = null;
		this.gaveUp = false;
		this.error = null;
		this.wrongSlot = null;
		this.fresh = [];
		this.deck = shuffle(this.deck);
		this.startedAt = Date.now();
		this.finishedAt = null;
	}
}

/* -------------------------------------------------------------------------- */
/* Judges                                                                     */
/* -------------------------------------------------------------------------- */

/** The normal path: the answer key never leaves the server. */
export function serverJudge(puzzleId: string): { judge: Judge; reveal: Revealer } {
	const post = async (path: string, body: unknown) => {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? 'Request failed.');
		return data;
	};

	return {
		judge: (attempt) => post('/api/guess', { puzzleId, ...attempt }),
		reveal: () => post('/api/solution', { puzzleId })
	};
}

/**
 * For a puzzle handed in by a host page over postMessage: there is no server
 * copy to check against, so the marking happens here. Same rules, and the same
 * "a link needs both its titles" reveal logic.
 */
export function localJudge(puzzle: Puzzle): { judge: Judge; reveal: Revealer } {
	const solution = (): SolvedPuzzle => ({
		chain: puzzle.chain,
		links: puzzle.links.map((link, index) => ({ ...link, index }))
	});

	return {
		judge: async ({ slot, ref, placed, strikes }) => {
			// Same rule as the server: a film only goes next to one already known.
			const last = puzzle.chain.length - 1;
			const has = (index: number) => placed[index] !== undefined;
			const openHere =
				!has(slot) &&
				(slot === 0 || has(slot - 1) || slot === last || has(slot + 1));
			if (!openHere) throw new Error('That slot has no known neighbour yet.');

			const correct = puzzle.chain[slot] && titleRef(puzzle.chain[slot]) === ref;
			if (!correct) {
				const spent = strikes + 1;
				return {
					correct: false,
					revealed: [],
					...(spent >= 3 ? { solution: solution() } : {})
				};
			}

			const known = new Set<number>([slot, ...Object.keys(placed).map(Number)]);
			const filled = (i: number) => i < 0 || i >= puzzle.chain.length || known.has(i);
			const revealed = puzzle.links
				.map((link, index) => ({ ...link, index }))
				.filter(({ index }) => filled(index - 1) && filled(index));

			return {
				correct: true,
				revealed,
				...(known.size === puzzle.chain.length ? { solution: solution() } : {})
			};
		},
		reveal: async () => solution()
	};
}
