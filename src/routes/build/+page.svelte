<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Poster from '$lib/components/Poster.svelte';
	import TitleSearch from '$lib/components/TitleSearch.svelte';
	import { profileUrl } from '$lib/images';
	import {
		titleRef,
		type SharedCastResult,
		type SharedPerson,
		type TitleSuggestion
	} from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let start = $state<TitleSuggestion | null>(null);
	let end = $state<TitleSuggestion | null>(null);
	/** The titles the player has to place, in chain order. */
	let middle = $state<TitleSuggestion[]>([]);

	/** Shared cast per adjacent pair, keyed by the two refs. */
	let candidates = $state<Record<string, SharedPerson[]>>({});
	let pairError = $state<Record<string, string>>({});
	/** Which shared person the author picked, where it isn't the top-billed one. */
	let chosen = $state<Record<string, number>>({});

	let saving = $state(false);
	let saved = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let copied = $state(false);
	let exported = $state<string | null>(null);
	/** Pair lookups this session that needed no API call at all. */
	let fromCache = $state(0);

	const slug = $derived(
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
	);

	/** start → middles → end, with nulls where the author hasn't chosen yet. */
	const nodes = $derived<(TitleSuggestion | null)[]>([start, ...middle, end]);

	const pairKey = (a: TitleSuggestion, b: TitleSuggestion) => `${titleRef(a)}|${titleRef(b)}`;

	const pairs = $derived(
		nodes.slice(0, -1).map((a, i) => {
			const b = nodes[i + 1];
			return { a, b, key: a && b ? pairKey(a, b) : null };
		})
	);

	/** Plain Set, deliberately not reactive: it only guards the fetch effect. */
	const requested = new Set<string>();

	$effect(() => {
		for (const pair of pairs) {
			if (!pair.key || requested.has(pair.key)) continue;
			requested.add(pair.key);
			void loadPair(pair.key, pair.a!, pair.b!);
		}
	});

	async function loadPair(key: string, a: TitleSuggestion, b: TitleSuggestion) {
		try {
			const res = await fetch(`/api/links?a=${titleRef(a)}&b=${titleRef(b)}`);
			const body = (await res.json()) as SharedCastResult & { error?: string };
			if (!res.ok) throw new Error(body.error ?? 'Lookup failed.');
			candidates = { ...candidates, [key]: body.cast };
			if (body.cached) fromCache = fromCache + 1;
		} catch (e) {
			pairError = { ...pairError, [key]: (e as Error).message };
			// Let a retry happen if the author changes the chain and comes back.
			requested.delete(key);
		}
	}

	/** The connection chosen for each pair — top-billed shared actor by default. */
	const links = $derived(
		pairs.map((pair) => {
			if (!pair.key) return null;
			const list = candidates[pair.key];
			if (!list?.length) return null;
			const picked = chosen[pair.key];
			return list.find((person) => person.id === picked) ?? list[0];
		})
	);

	const roleText = (person: SharedPerson) =>
		[person.inA.character || 'uncredited', person.inB.character || 'uncredited'] as [
			string,
			string
		];

	const problems = $derived.by(() => {
		const out: string[] = [];
		if (!slug) out.push('Give the puzzle a name.');
		if (!start) out.push('Pick a start title.');
		if (!end) out.push('Pick an end title.');
		if (!middle.length) out.push('Add at least one film to the chain.');

		pairs.forEach((pair, i) => {
			if (!pair.key) return;
			const from = pair.a!.title;
			const to = pair.b!.title;
			if (pairError[pair.key]) out.push(`Connection ${i + 1} (${from} → ${to}): ${pairError[pair.key]}`);
			else if (!candidates[pair.key]) out.push(`Connection ${i + 1} (${from} → ${to}): still checking…`);
			else if (!candidates[pair.key].length)
				out.push(`Connection ${i + 1}: ${from} and ${to} share nobody in the cast.`);
		});

		if (new Set(middle.map(titleRef)).size !== middle.length) {
			out.push('The same film appears twice in the chain.');
		}
		return out;
	});

	const ready = $derived(problems.length === 0 && links.every(Boolean));

	function puzzleJson() {
		return {
			id: slug,
			name: name.trim(),
			start,
			end,
			chain: middle,
			links: links.map((person) =>
				person
					? {
							personId: person.id,
							name: person.name,
							profilePath: person.profilePath,
							roles: roleText(person)
						}
					: null
			)
		};
	}

	async function save() {
		saving = true;
		saveError = null;
		saved = null;
		try {
			const res = await fetch('/api/puzzles', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(puzzleJson())
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Save failed.');
			saved = body.saved;
			await invalidateAll();
		} catch (e) {
			saveError = (e as Error).message;
		} finally {
			saving = false;
		}
	}

	async function copyJson() {
		await navigator.clipboard.writeText(JSON.stringify(puzzleJson(), null, '\t'));
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	/** Puzzles live in SQLite; this writes them back to the committed seed file. */
	async function exportToSeed() {
		exported = null;
		const res = await fetch('/api/puzzles', { method: 'PUT' });
		const body = await res.json();
		exported = res.ok
			? `Wrote ${body.puzzles} puzzle${body.puzzles === 1 ? '' : 's'} to ${body.path}`
			: body.error;
	}

	async function remove(id: string) {
		if (!confirm(`Delete "${id}" from the library?`)) return;
		const res = await fetch(`/api/puzzles?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
		if (res.ok) await invalidateAll();
		else saveError = (await res.json()).error ?? 'Delete failed.';
	}

	function move(index: number, by: number) {
		const to = index + by;
		if (to < 0 || to >= middle.length) return;
		const next = [...middle];
		[next[index], next[to]] = [next[to], next[index]];
		middle = next;
	}

	function reset() {
		name = '';
		start = null;
		end = null;
		middle = [];
		chosen = {};
		saved = null;
		saveError = null;
	}
</script>

<svelte:head><title>Puzzle builder — Actor Connect</title></svelte:head>

<main class="mx-auto w-full max-w-2xl px-4 py-8">
	<header class="mb-6">
		<p class="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">Actor Connect</p>
		<h1 class="mt-1 text-2xl font-bold text-slate-50">Puzzle builder</h1>
		<p class="mt-2 text-sm text-slate-400">
			Pick the two ends and the films between them. Every adjacent pair is checked against TMDB, and
			the shared actor becomes the connection the player uncovers.
		</p>
	</header>

	<!-- What the cache is doing for us. The whole point of the database is that
	     these numbers grow while the call count doesn't. -->
	<dl
		class="mb-6 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm sm:grid-cols-4"
	>
		<div>
			<dt class="text-xs text-slate-500">TMDB calls, ever</dt>
			<dd class="font-semibold text-amber-200">{data.stats.calls.total}</dd>
		</div>
		<div>
			<dt class="text-xs text-slate-500">Last 24 hours</dt>
			<dd class="font-semibold text-slate-200">{data.stats.calls.today}</dd>
		</div>
		<div>
			<dt class="text-xs text-slate-500">Films &amp; shows cached</dt>
			<dd class="font-semibold text-slate-200">
				{data.stats.titlesWithCast}<span class="text-slate-500">/{data.stats.titles}</span>
			</dd>
		</div>
		<div>
			<dt class="text-xs text-slate-500">Cast credits held</dt>
			<dd class="font-semibold text-slate-200">
				{data.stats.castRows.toLocaleString('en-GB')}
			</dd>
		</div>
	</dl>
	{#if fromCache}
		<p class="mb-6 -mt-4 text-xs text-emerald-300/80">
			{fromCache} connection{fromCache === 1 ? '' : 's'} answered from the database this session —
			no API calls.
		</p>
	{/if}

	<!-- ---------------------------------------------------------------- Name -->
	<div class="mb-6">
		<label for="puzzle-name" class="mb-1.5 block text-xs font-semibold tracking-widest text-slate-400 uppercase">
			Puzzle name
		</label>
		<input
			id="puzzle-name"
			bind:value={name}
			placeholder="Con Air to Waterworld"
			class="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/20"
		/>
		{#if slug}<p class="mt-1.5 text-xs text-slate-500">id: <code>{slug}</code></p>{/if}
	</div>

	<!-- --------------------------------------------------------------- Chain -->
	<section class="space-y-3">
		<h2 class="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">The chain</h2>

		<TitleSearch label="Start title" bind:selected={start} placeholder="e.g. Con Air" />

		{#each pairs as pair, i (pair.key ?? `pending-${i}`)}
			{@const list = pair.key ? candidates[pair.key] : undefined}
			<!-- One connection: which shared actor joins this pair. -->
			<div class="ml-4 border-l-2 border-slate-800 pl-4">
				{#if !pair.key}
					<p class="py-2 text-xs text-slate-600">Connection {i + 1} — waiting for both films.</p>
				{:else if pairError[pair.key]}
					<p class="py-2 text-xs text-rose-400">{pairError[pair.key]}</p>
				{:else if !list}
					<p class="py-2 text-xs text-slate-500">Checking who's in both…</p>
				{:else if !list.length}
					<p class="py-2 text-xs text-rose-400">
						Nobody in common. Try a different film here.
					</p>
				{:else}
					{@const picked = links[i]}
					<div class="flex items-center gap-2 py-1.5">
						{#if picked && profileUrl(picked.profilePath, 'w185')}
							<img
								src={profileUrl(picked.profilePath, 'w185')}
								alt=""
								class="size-8 shrink-0 rounded-full border border-amber-400/60 object-cover"
							/>
						{:else}
							<span class="size-8 shrink-0 rounded-full bg-slate-800"></span>
						{/if}
						<select
							value={picked?.id}
							onchange={(event) =>
								(chosen = { ...chosen, [pair.key!]: Number(event.currentTarget.value) })}
							class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-amber-400/70"
						>
							{#each list as person (person.id)}
								<option value={person.id}>
									{person.name} — {roleText(person)[0]} → {roleText(person)[1]}
								</option>
							{/each}
						</select>
					</div>
					{#if list.length > 1}
						<p class="text-[0.7rem] text-slate-600">
							{list.length} people are in both; the player only needs to name one.
						</p>
					{/if}
				{/if}
			</div>

			<!-- The film after this connection, unless it's the end title. -->
			{#if i < middle.length}
				{@const film = middle[i]}
				<div class="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 p-2.5">
					<div class="w-10 shrink-0"><Poster title={film} size="w92" /></div>
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-semibold text-slate-100">{film.title}</p>
						<p class="text-xs text-slate-500">{film.year ?? '—'} · slot {i + 1}</p>
					</div>
					<div class="flex shrink-0 gap-1">
						<button
							type="button"
							onclick={() => move(i, -1)}
							disabled={i === 0}
							aria-label="Move {film.title} earlier"
							class="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 transition enabled:hover:text-slate-100 disabled:opacity-30"
						>↑</button>
						<button
							type="button"
							onclick={() => move(i, 1)}
							disabled={i === middle.length - 1}
							aria-label="Move {film.title} later"
							class="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 transition enabled:hover:text-slate-100 disabled:opacity-30"
						>↓</button>
						<button
							type="button"
							onclick={() => (middle = middle.filter((_, at) => at !== i))}
							aria-label="Remove {film.title}"
							class="rounded-md border border-slate-700 px-2 py-1 text-xs text-rose-400 transition hover:border-rose-500/50"
						>✕</button>
					</div>
				</div>
			{/if}
		{/each}

		<div class="ml-4 border-l-2 border-dashed border-slate-800 pl-4">
			<TitleSearch
				label="Add the next film in the chain"
				placeholder="e.g. The Rock"
				clearOnSelect
				onselect={(title) => (middle = [...middle, title])}
			/>
		</div>

		<TitleSearch label="End title" bind:selected={end} placeholder="e.g. Waterworld" />
	</section>

	<!-- ---------------------------------------------------------------- Save -->
	<section class="mt-8 border-t border-slate-800 pt-5">
		{#if problems.length}
			<ul class="mb-4 space-y-1 text-sm text-slate-500">
				{#each problems as problem}
					<li>• {problem}</li>
				{/each}
			</ul>
		{:else}
			<p class="mb-4 text-sm text-emerald-300">
				Ready: {middle.length} film{middle.length === 1 ? '' : 's'} to place,
				{links.length} connection{links.length === 1 ? '' : 's'}.
			</p>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onclick={save}
				disabled={!ready || saving}
				class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
			>
				{saving ? 'Saving…' : 'Save to library'}
			</button>
			<button
				type="button"
				onclick={copyJson}
				disabled={!ready}
				class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500 disabled:opacity-40"
			>
				{copied ? 'Copied' : 'Copy JSON'}
			</button>
			<button
				type="button"
				onclick={reset}
				class="rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:text-slate-300"
			>
				Start over
			</button>
		</div>

		{#if saveError}
			<p class="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
				{saveError}
			</p>
		{/if}
		{#if saved}
			<p class="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
				Saved as <code>{saved}</code> ·
				<a href="/?puzzle={saved}" class="underline">play it</a>
			</p>
		{/if}
	</section>

	<!-- ------------------------------------------------------------- Library -->
	<section class="mt-10">
		<div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
				In the library ({data.puzzles.length})
			</h2>
			{#if data.canExportSeed}
				<button
					type="button"
					onclick={exportToSeed}
					class="text-xs text-slate-500 underline decoration-dotted underline-offset-4 transition hover:text-slate-300"
				>
					Write to library.json
				</button>
			{/if}
		</div>
		<p class="mb-3 text-[0.7rem] break-all text-slate-600">{data.store}</p>
		{#if exported}
			<p class="mb-3 text-xs text-emerald-300">{exported}</p>
		{/if}
		<ul class="divide-y divide-slate-800 rounded-xl border border-slate-800">
			{#each data.puzzles as puzzle (puzzle.id)}
				<li class="flex items-center gap-3 px-3 py-2.5">
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm text-slate-200">{puzzle.name}</span>
						<span class="text-xs text-slate-500">
							{puzzle.slots} to place · {puzzle.source}
						</span>
					</span>
					<a
						href="/?puzzle={puzzle.id}"
						class="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500"
					>Play</a>
					<button
						type="button"
						onclick={() => remove(puzzle.id)}
						class="shrink-0 rounded-md border border-slate-700 px-2.5 py-1 text-xs text-rose-400 transition hover:border-rose-500/50"
					>Delete</button>
				</li>
			{:else}
				<li class="px-3 py-4 text-sm text-slate-500">Nothing yet.</li>
			{/each}
		</ul>
	</section>

	<p class="mt-8 text-center text-xs text-slate-700">
		<a href="/" class="transition hover:text-slate-500">← Back to the game</a>
	</p>
</main>
