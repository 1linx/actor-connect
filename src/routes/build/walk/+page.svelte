<script lang="ts">
	import Connection from '$lib/components/Connection.svelte';
	import FameMeter from '$lib/components/FameMeter.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import TitleNode from '$lib/components/TitleNode.svelte';
	import TitleSearch from '$lib/components/TitleSearch.svelte';
	import { profileUrl } from '$lib/images';
	import { titleRef, type PuzzleLink, type TitleSummary } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/* ---------------------------------------------------------------------- */
	/* The walk                                                               */
	/* ---------------------------------------------------------------------- */

	/** Films chosen, in chain order. The first and last become the two anchors. */
	let titles = $state<TitleSummary[]>([]);
	/** Completed connections. `links[i]` joins `titles[i]` to `titles[i + 1]`. */
	let links = $state<PuzzleLink[]>([]);
	/**
	 * An actor picked from the last film's cast, waiting for the film they lead
	 * to. Their character in the *earlier* film is known now; the character in
	 * the later one arrives with the film, which is what completes the link.
	 */
	let pending = $state<{
		personId: number;
		name: string;
		profilePath: string | null;
		characterBefore: string;
		popularity: number;
	} | null>(null);

	/** What the walk is waiting for. */
	const step = $derived(
		titles.length === 0 ? 'opening-film' : pending ? 'next-film' : 'actor'
	);
	const lastTitle = $derived(titles[titles.length - 1] ?? null);
	const canFinish = $derived(step === 'actor' && titles.length >= 3);

	/* ---------------------------------------------------------------------- */
	/* How obscure we're willing to go                                        */
	/* ---------------------------------------------------------------------- */

	/**
	 * Thresholds picked from the real numbers rather than guessed. Across Con
	 * Air's 60-name cast, a popularity floor of 1 leaves 33 people and 2 leaves
	 * 17 — which is the difference between a wall of extras and a usable list.
	 */
	const ACTOR_TIERS = [
		{ label: 'Everyone', value: 0, note: 'the full cast list, extras and all' },
		{ label: 'Named cast', value: 1, note: 'drops the one-line parts' },
		{ label: 'Recognisable', value: 2, note: 'faces most people could place' },
		{ label: 'Big names', value: 3.5, note: 'leads and famous character actors' }
	];

	/** Ratings *count*, not score: a 9.0 with twelve votes is still obscure. */
	const FILM_TIERS = [
		{ label: 'Anything', value: 0, note: 'includes shorts and documentaries' },
		{ label: 'Fairly known', value: 250, note: '250+ ratings' },
		{ label: 'Well known', value: 1000, note: '1,000+ ratings' },
		{ label: 'Household names', value: 4000, note: '4,000+ ratings' }
	];

	let actorTier = $state(2);
	let filmTier = $state(2);

	/* ---------------------------------------------------------------------- */
	/* Fetching the options for the current step                              */
	/* ---------------------------------------------------------------------- */

	interface CastOption {
		personId: number;
		name: string;
		profilePath: string | null;
		character: string;
		billing: number | null;
		popularity: number;
	}
	interface FilmOption extends TitleSummary {
		character: string;
		billing: number | null;
		popularity: number;
		voteCount: number;
		voteAverage: number;
	}

	let cast = $state<CastOption[]>([]);
	let films = $state<FilmOption[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	/** True when the last lookup needed no TMDB call. */
	let fromCache = $state(false);

	/** Only the newest request may write state. */
	let seq = 0;

	$effect(() => {
		// Read every dependency up front so the effect re-runs when any changes.
		const current = step;
		const anchor = lastTitle;
		const actor = pending;
		const actorFame = ACTOR_TIERS[actorTier].value;
		const filmFame = FILM_TIERS[filmTier].value;

		if (current === 'opening-film') {
			cast = [];
			films = [];
			return;
		}

		const mine = ++seq;
		loading = true;
		error = null;

		const url =
			current === 'actor'
				? `/api/cast?ref=${titleRef(anchor!)}&fame=${actorFame}`
				: `/api/filmography?person=${actor!.personId}&fame=${filmFame}`;

		fetch(url)
			.then(async (res) => {
				const body = await res.json();
				if (mine !== seq) return;
				if (!res.ok) throw new Error(body.error ?? 'Lookup failed.');

				fromCache = body.cached;
				if (current === 'actor') {
					cast = body.cast;
					films = [];
				} else {
					cast = [];
					films = body.films;
				}
			})
			.catch((e) => {
				if (mine !== seq) return;
				error = (e as Error).message;
			})
			.finally(() => {
				if (mine === seq) loading = false;
			});
	});

	/** Films already in the chain can't be reused — they'd be right twice. */
	const used = $derived(new Set(titles.map(titleRef)));
	const offered = $derived(films.filter((film) => !used.has(titleRef(film))));

	/**
	 * Actors already used as a connection. Reusing one is legal — a run of Bond
	 * films joined by Brosnan is a fine chain — but it makes for a thinner
	 * puzzle, so it's worth seeing before you pick rather than after.
	 */
	const usedPeople = $derived(new Set(links.map((link) => link.personId)));

	/* ---------------------------------------------------------------------- */
	/* Walking                                                               */
	/* ---------------------------------------------------------------------- */

	function openWith(title: TitleSummary) {
		titles = [title];
		links = [];
		pending = null;
	}

	function pickActor(member: CastOption) {
		pending = {
			personId: member.personId,
			name: member.name,
			profilePath: member.profilePath,
			characterBefore: member.character,
			popularity: member.popularity
		};
	}

	function pickFilm(film: FilmOption) {
		if (!pending) return;
		titles = [...titles, { id: film.id, mediaType: film.mediaType, title: film.title, year: film.year, posterPath: film.posterPath }];
		links = [
			...links,
			{
				personId: pending.personId,
				name: pending.name,
				profilePath: pending.profilePath,
				roles: [pending.characterBefore, film.character]
			}
		];
		pending = null;
	}

	function undo() {
		if (pending) {
			pending = null;
			return;
		}
		if (titles.length > 1) {
			titles = titles.slice(0, -1);
			links = links.slice(0, -1);
			return;
		}
		titles = [];
		links = [];
	}

	function startOver() {
		titles = [];
		links = [];
		pending = null;
		name = '';
		saved = null;
		saveError = null;
	}

	/* ---------------------------------------------------------------------- */
	/* Saving                                                                 */
	/* ---------------------------------------------------------------------- */

	let name = $state('');
	let saving = $state(false);
	let saved = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let copied = $state(false);

	const suggestedName = $derived(
		titles.length >= 2 ? `${titles[0].title} to ${titles[titles.length - 1].title}` : ''
	);
	const finalName = $derived(name.trim() || suggestedName);
	const slug = $derived(
		finalName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
	);

	function puzzleJson() {
		return {
			id: slug,
			name: finalName,
			start: titles[0],
			end: titles[titles.length - 1],
			chain: titles.slice(1, -1),
			links
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

	const ratings = (votes: number) =>
		votes >= 1000 ? `${(votes / 1000).toFixed(votes < 10000 ? 1 : 0)}k` : String(votes);
</script>

<svelte:head><title>Walk the cast — Actor Connect</title></svelte:head>

<main class="mx-auto w-full max-w-2xl px-4 py-8">
	<header class="mb-5">
		<p class="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">Actor Connect</p>
		<h1 class="mt-1 text-2xl font-bold text-slate-50">Walk the cast</h1>
		<p class="mt-2 text-sm text-slate-400">
			Start with a film, pick an actor from it, pick one of their other films, and keep going. The
			first and last films become the two ends of the puzzle; everything between is what the player
			has to place.
		</p>
		<p class="mt-2 text-xs text-slate-500">
			{data.stats.calls.total} TMDB calls ever · one per new film, one per new actor, never twice ·
			<a href="/build" class="underline decoration-dotted hover:text-slate-300">
				the pick-the-films builder is still here
			</a>
		</p>
	</header>

	<!-- ------------------------------------------------------- The chain so far -->
	{#if titles.length}
		<section class="mb-6">
			<div class="mb-2 flex items-baseline justify-between">
				<h2 class="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
					The chain ({titles.length} film{titles.length === 1 ? '' : 's'})
				</h2>
				<button
					type="button"
					onclick={undo}
					class="text-xs text-slate-500 underline decoration-dotted underline-offset-4 transition hover:text-slate-300"
				>
					Undo last
				</button>
			</div>

			<!-- Same rail and rows the game uses, so this previews as it will play. -->
			<div class="relative">
				<div
					aria-hidden="true"
					class="chain-rail absolute top-8 bottom-8 w-px bg-linear-to-b from-slate-800 via-slate-700 to-slate-800"
				></div>
				<div class="relative flex flex-col gap-1">
					{#each titles as title, i (titleRef(title))}
						<TitleNode
							{title}
							tone="anchor"
							label={i === 0 ? 'Start' : i === titles.length - 1 && step === 'actor' && titles.length > 1 ? 'Finish so far' : null}
						/>
						{#if links[i]}
							<Connection index={i} link={links[i]} />
						{/if}
					{/each}

					{#if pending}
						<!-- Half a link: the actor is chosen, the film they lead to isn't. -->
						<Connection
							index={links.length}
							link={{
								personId: pending.personId,
								name: pending.name,
								profilePath: pending.profilePath,
								roles: [pending.characterBefore, '…']
							}}
							fresh
						/>
						<div class="chain-row rounded-xl border-2 border-dashed border-amber-400/40 py-2.5">
							<span class="flex justify-center">
								<span class="grid size-8 place-items-center rounded-md border border-dashed border-amber-400/50 text-base font-bold text-amber-300/70">?</span>
							</span>
							<span class="text-sm text-amber-200/70">Pick one of their films below</span>
						</div>
					{/if}
				</div>
			</div>
		</section>
	{/if}

	<!-- ----------------------------------------------------------- Current step -->
	<section class="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
		{#if step === 'opening-film'}
			<h2 class="mb-3 text-sm font-semibold text-slate-200">Start with a film</h2>
			<TitleSearch
				label="Opening film"
				placeholder="e.g. Con Air"
				clearOnSelect
				onselect={openWith}
			/>
		{:else}
			<div class="mb-3 flex flex-wrap items-start justify-between gap-3">
				<h2 class="text-sm font-semibold text-slate-200">
					{#if step === 'actor'}
						Who takes us out of <span class="text-amber-200">{lastTitle?.title}</span>?
					{:else}
						Which film next for <span class="text-amber-200">{pending?.name}</span>?
					{/if}
				</h2>
				{#if !loading && (cast.length || offered.length)}
					<span class="text-xs {fromCache ? 'text-emerald-300/70' : 'text-slate-500'}">
						{fromCache ? 'from the database — no API call' : 'fetched once, cached forever'}
					</span>
				{/if}
			</div>

			<!-- The obscurity dial for whichever list is showing. -->
			{#if step === 'actor'}
				{@const tier = ACTOR_TIERS[actorTier]}
				<label class="mb-4 block">
					<span class="flex items-baseline justify-between text-xs">
						<span class="font-semibold tracking-wide text-slate-400 uppercase">How well known</span>
						<span class="text-slate-300">{tier.label} <span class="text-slate-600">· {tier.note}</span></span>
					</span>
					<input
						type="range"
						min="0"
						max={ACTOR_TIERS.length - 1}
						step="1"
						bind:value={actorTier}
						class="mt-1.5 w-full accent-amber-400"
					/>
				</label>
			{:else}
				{@const tier = FILM_TIERS[filmTier]}
				<label class="mb-4 block">
					<span class="flex items-baseline justify-between text-xs">
						<span class="font-semibold tracking-wide text-slate-400 uppercase">How well known</span>
						<span class="text-slate-300">{tier.label} <span class="text-slate-600">· {tier.note}</span></span>
					</span>
					<input
						type="range"
						min="0"
						max={FILM_TIERS.length - 1}
						step="1"
						bind:value={filmTier}
						class="mt-1.5 w-full accent-amber-400"
					/>
				</label>
			{/if}

			{#if error}
				<p class="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
					{error}
				</p>
			{:else if loading}
				<p class="py-6 text-center text-sm text-slate-500">Looking…</p>
			{:else if step === 'actor'}
				{#if cast.length}
					<ul class="grid gap-1.5 sm:grid-cols-2">
						{#each cast as member (member.personId)}
							<li>
								<button
									type="button"
									onclick={() => pickActor(member)}
									class="flex w-full items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-left transition hover:border-amber-400/50 hover:bg-slate-800/60"
								>
									{#if profileUrl(member.profilePath, 'w185')}
										<img src={profileUrl(member.profilePath, 'w185')} alt="" loading="lazy" class="size-9 shrink-0 rounded-full object-cover" />
									{:else}
										<span class="grid size-9 shrink-0 place-items-center rounded-full bg-slate-800 text-xs text-slate-500">
											{member.name.slice(0, 1)}
										</span>
									{/if}
									<span class="min-w-0 flex-1">
										<span class="block truncate text-sm text-slate-100">
											{member.name}
											{#if usedPeople.has(member.personId)}
												<span class="ml-1 rounded bg-slate-800 px-1.5 py-0.5 align-middle text-[0.6rem] tracking-wide text-slate-400 uppercase">
													used
												</span>
											{/if}
										</span>
										<span class="block truncate text-xs text-slate-500">
											{member.character || 'uncredited'}
										</span>
									</span>
									<FameMeter popularity={member.popularity} />
								</button>
							</li>
						{/each}
					</ul>
					<p class="mt-3 text-xs text-slate-600">
						In billing order, so the leads stay at the top. {cast.length} shown.
					</p>
				{:else}
					<p class="py-4 text-sm text-slate-500">
						Nobody in this cast clears that threshold — try loosening the dial.
					</p>
				{/if}
			{:else if offered.length}
				<ul class="grid gap-1.5 sm:grid-cols-2">
					{#each offered as film (titleRef(film))}
						<li>
							<button
								type="button"
								onclick={() => pickFilm(film)}
								class="flex w-full items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 p-2 text-left transition hover:border-amber-400/50 hover:bg-slate-800/60"
							>
								<span class="w-8 shrink-0"><Poster title={film} size="w92" /></span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-sm text-slate-100">{film.title}</span>
									<span class="block truncate text-xs text-slate-500">
										{film.year ?? '—'} · as {film.character || 'uncredited'}
									</span>
								</span>
								<span class="shrink-0 text-right text-xs">
									<span class="block text-amber-200/90">★ {film.voteAverage.toFixed(1)}</span>
									<span class="block text-slate-600">{ratings(film.voteCount)}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
				<p class="mt-3 text-xs text-slate-600">
					Best known first. {offered.length} shown{films.length !== offered.length
						? `, ${films.length - offered.length} already in the chain`
						: ''}.
				</p>
			{:else}
				<p class="py-4 text-sm text-slate-500">
					No films left at that threshold — loosen the dial, or undo and pick a different actor.
				</p>
			{/if}
		{/if}
	</section>

	<!-- ---------------------------------------------------------------- Finish -->
	{#if titles.length >= 2}
		<section class="mt-6 border-t border-slate-800 pt-5">
			{#if canFinish}
				<h2 class="mb-3 text-sm font-semibold text-slate-200">Save it</h2>
				<label class="mb-3 block">
					<span class="mb-1.5 block text-xs font-semibold tracking-widest text-slate-400 uppercase">
						Puzzle name
					</span>
					<input
						bind:value={name}
						placeholder={suggestedName}
						class="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 outline-none focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/20"
					/>
				</label>
				<p class="mb-4 text-sm text-slate-400">
					<span class="text-slate-200">{titles[0].title}</span> → {titles.length - 2} film{titles.length -
						2 ===
					1
						? ''
						: 's'} to place → <span class="text-slate-200">{titles[titles.length - 1].title}</span>,
					{links.length} connection{links.length === 1 ? '' : 's'}.
					{#if slug}<span class="text-slate-600">id: {slug}</span>{/if}
				</p>

				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onclick={save}
						disabled={saving || !slug}
						class="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-40"
					>
						{saving ? 'Saving…' : 'Save to library'}
					</button>
					<button
						type="button"
						onclick={copyJson}
						class="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
					>
						{copied ? 'Copied' : 'Copy JSON'}
					</button>
					<button
						type="button"
						onclick={startOver}
						class="rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:text-slate-300"
					>
						Start over
					</button>
				</div>
			{:else}
				<p class="text-sm text-slate-500">
					{#if step === 'next-film'}
						Pick {pending?.name}'s next film to close this connection.
					{:else}
						One more film and this is savable — a puzzle needs at least one to place between the
						two ends.
					{/if}
				</p>
			{/if}

			{#if saveError}
				<p class="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
					{saveError}
				</p>
			{/if}
			{#if saved}
				<p class="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
					Saved as <code>{saved}</code> ·
					<a href="/?puzzle={saved}" class="underline">play it</a> ·
					<a href="/build" class="underline">library</a>
				</p>
			{/if}
		</section>
	{/if}

	<p class="mt-8 text-center text-xs text-slate-700">
		<a href="/" class="transition hover:text-slate-500">← Back to the game</a>
	</p>
</main>
