<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ChainSlot from '$lib/components/ChainSlot.svelte';
	import Connection from '$lib/components/Connection.svelte';
	import Deck from '$lib/components/Deck.svelte';
	import Outcome from '$lib/components/Outcome.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Strikes from '$lib/components/Strikes.svelte';
	import TitleNode from '$lib/components/TitleNode.svelte';
	import { drag } from '$lib/drag.svelte';
	import { createBridge, type Inbound } from '$lib/embed';
	import { Game, localJudge, playableFrom, serverJudge } from '$lib/game.svelte';
	import type { Puzzle, TitleSummary } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** `?embed=1` drops the page chrome for use inside an iframe. */
	const embed = $derived(page.url.searchParams.has('embed'));
	const parentOrigin = $derived(page.url.searchParams.get('parentOrigin'));

	/** A puzzle pushed in by the host page takes precedence over the library. */
	let injected = $state<Puzzle | null>(null);

	let game = $state<Game | null>(null);

	$effect(() => {
		if (injected) {
			const { judge, reveal } = localJudge(injected);
			game = new Game(playableFrom(injected), judge, reveal);
			return;
		}
		if (data.playable) {
			const { judge, reveal } = serverJudge(data.playable.id);
			game = new Game(data.playable, judge, reveal);
		}
	});

	/* ---------------------------------------------------------------------- */
	/* Host page bridge                                                       */
	/* ---------------------------------------------------------------------- */

	let bridge = $state<ReturnType<typeof createBridge> | null>(null);

	$effect(() => {
		const b = createBridge({ parentOrigin, onCommand: command });
		bridge = b;
		return () => {
			bridge = null;
			b.destroy();
		};
	});

	// Announce the board once it exists, so a host can size and label its frame.
	$effect(() => {
		const active = game;
		if (!active || !bridge) return;
		bridge.send('ready', {
			puzzleId: active.puzzle.id,
			name: active.puzzle.name,
			slots: active.puzzle.slots,
			strikeLimit: active.puzzle.strikeLimit
		});
	});

	function command(message: Inbound) {
		if (message.type === 'restart') {
			game?.restart();
			return;
		}
		if (message.puzzle) {
			injected = message.puzzle;
			return;
		}
		if (message.puzzleId) {
			injected = null;
			goto(url(message.puzzleId), { invalidateAll: true });
		}
	}

	/** Keep `embed` and `parentOrigin` when switching puzzle. */
	function url(id: string) {
		const next = new URLSearchParams(page.url.searchParams);
		next.set('puzzle', id);
		return `?${next}`;
	}

	$effect(() => {
		document.body.classList.toggle('embed', embed);
	});

	/* ---------------------------------------------------------------------- */
	/* Play                                                                   */
	/* ---------------------------------------------------------------------- */

	async function place(slot: number, title: TitleSummary) {
		const active = game;
		if (!active) return;

		const strikesBefore = active.strikes;
		await active.place(slot, title);
		drag.clear();

		// A correct placement unlocks the slot next to it — bring that into view,
		// since it's the continuation of whichever end the player is working from.
		// `nearest` means nothing moves when it's already on screen.
		if (active.strikes === strikesBefore && !active.over) {
			const unlocked = [slot - 1, slot + 1].find((index) => active.openSlots.has(index));
			if (unlocked !== undefined) {
				requestAnimationFrame(() => {
					document
						.querySelector(`[data-slot="${unlocked}"]`)
						?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
				});
			}
		}

		if (!bridge?.active) return;
		if (active.strikes > strikesBefore) {
			bridge.send('strike', { strikes: active.strikes, strikesLeft: active.strikesLeft });
		}
		for (const index of active.fresh) {
			const link = active.links[index];
			if (link) bridge.send('reveal', { index, name: link.name, personId: link.personId });
		}
		bridge.send('progress', {
			placed: active.placedCount,
			slots: active.puzzle.slots,
			strikes: active.strikes,
			strikesLeft: active.strikesLeft
		});
		if (active.status === 'won') {
			bridge.send('won', {
				strikes: active.strikes,
				elapsedMs: (active.finishedAt ?? Date.now()) - active.startedAt
			});
		} else if (active.status === 'lost') {
			bridge.send('lost', {
				elapsedMs: (active.finishedAt ?? Date.now()) - active.startedAt
			});
		}
	}

	async function giveUp() {
		await game?.giveUp();
		if (game?.gaveUp) bridge?.send('revealed', {});
	}

	function nextPuzzle() {
		if (!game || data.index.length < 2) return;
		const at = data.index.findIndex((p) => p.id === game!.puzzle.id);
		const next = data.index[(at + 1) % data.index.length];
		goto(url(next.id), { invalidateAll: true });
	}

	const elapsed = $derived(
		game?.finishedAt !== null && game?.finishedAt !== undefined
			? game.finishedAt - game.startedAt
			: null
	);
</script>

<svelte:head>
	<title>{game ? `${game.puzzle.name} — Actor Connect` : 'Actor Connect'}</title>
	<meta
		name="description"
		content="A movie trivia chain: place the films that connect the two ends, one shared actor at a time."
	/>
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') drag.clear();
	}}
/>

<main class="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4">
	{#if !embed}
		<header class="pt-6 pb-2 text-center">
			<h1 class="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">Actor Connect</h1>
			<p class="mx-auto mt-1.5 max-w-sm text-sm text-slate-400">
				Rebuild the chain between two films. Get one right and the actor who links it appears.
			</p>
		</header>
	{/if}

	{#if data.missing}
		<p class="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
			No puzzle called <code>{data.missing}</code> in the library.
		</p>
	{/if}

	{#if !game}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
			{#if data.index.length}
				<!-- The library has puzzles, just not the one that was asked for. -->
				<p class="text-slate-400">Pick one of these instead:</p>
				<ul class="flex flex-col items-center gap-2">
					{#each data.index as entry (entry.id)}
						<li>
							<a
								href={url(entry.id)}
								data-sveltekit-reload
								class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-amber-400/60"
							>
								{entry.name}
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-slate-400">The puzzle library is empty.</p>
				{#if data.canEdit}
					<a
						href="/build"
						class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
					>
						Build the first puzzle
					</a>
				{/if}
			{/if}
		</div>
	{:else}
		<!-- Status bar: which puzzle, and how much rope is left. -->
		<div
			class="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-2.5 backdrop-blur"
		>
			<div class="min-w-0">
				<p class="truncate text-sm font-semibold text-slate-200">{game.puzzle.name}</p>
				<p class="text-xs text-slate-500">
					{game.placedCount} of {game.puzzle.slots} placed
				</p>
			</div>
			<Strikes strikes={game.strikes} limit={game.puzzle.strikeLimit} />
		</div>

		<section class="flex-1 pt-4">
			{#if game.over}
				<div class="mb-4">
					<Outcome
						status={game.status}
						strikes={game.strikes}
						elapsedMs={elapsed}
						onrestart={() => game?.restart()}
						onnext={data.index.length > 1 ? nextPuzzle : null}
					/>
				</div>
			{/if}

			{#if game.error}
				<p class="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
					{game.error}
				</p>
			{/if}

			<!-- The chain. A single rail runs behind every row, at the centre of the
			     poster column, so the cards and the connection faces line up. -->
			<div class="relative">
				<div
					aria-hidden="true"
					class="chain-rail absolute top-8 bottom-8 w-px bg-linear-to-b from-slate-800 via-slate-700 to-slate-800"
				></div>

				<div class="relative flex flex-col gap-1">
					<TitleNode title={game.puzzle.start} label="Start" tone="anchor" />

					{#each { length: game.puzzle.slots }, slot}
						<Connection
							index={slot}
							link={game.linkAt(slot)}
							fresh={game.fresh.includes(slot)}
							earned={slot in game.links}
						/>
						<ChainSlot
							index={slot}
							filled={game.slotAt(slot)}
							wrong={game.wrongSlot === slot}
							locked={game.over}
							open={game.openSlots.has(slot)}
							onplace={(target) => {
								if (drag.held) place(target, drag.held);
							}}
						/>
					{/each}

					<Connection
						index={game.puzzle.slots}
						link={game.linkAt(game.puzzle.slots)}
						fresh={game.fresh.includes(game.puzzle.slots)}
						earned={game.puzzle.slots in game.links}
					/>

					<TitleNode title={game.puzzle.end} label="Finish" tone="anchor" />
				</div>
			</div>

			{#if !game.over}
				<div class="mt-5 flex justify-center">
					<button
						type="button"
						onclick={giveUp}
						disabled={game.busy}
						class="text-xs text-slate-600 underline decoration-dotted underline-offset-4 transition hover:text-slate-400"
					>
						Give up and show the chain
					</button>
				</div>
			{/if}
		</section>

		<Deck hand={game.hand} locked={game.over} onplace={place} />
	{/if}

	{#if !embed && data.index.length > 1}
		<nav class="flex flex-wrap items-center justify-center gap-2 py-4 text-xs">
			<span class="text-slate-600">More:</span>
			{#each data.index as entry (entry.id)}
				{#if entry.id !== game?.puzzle.id}
					<a
						href={url(entry.id)}
						data-sveltekit-reload
						class="rounded-full border border-slate-800 px-2.5 py-1 text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
					>
						{entry.name}
					</a>
				{/if}
			{/each}
		</nav>
	{/if}

	{#if !embed && data.canEdit}
		<p class="pb-4 text-center text-xs text-slate-700">
			<a href="/build" class="transition hover:text-slate-500">Puzzle builder</a>
		</p>
	{/if}
</main>

<!-- The card under the finger. Pointer-events off so hit-testing sees the slots. -->
{#if drag.dragging && drag.held}
	<div
		aria-hidden="true"
		class="pointer-events-none fixed z-50 w-20 -translate-x-1/2 -translate-y-1/2 rotate-3 opacity-90 drop-shadow-2xl"
		style="left: {drag.x}px; top: {drag.y}px"
	>
		<Poster title={drag.held} size="w154" />
	</div>
{/if}
