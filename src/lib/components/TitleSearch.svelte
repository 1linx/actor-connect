<script lang="ts">
	import { posterUrl } from '$lib/images';
	import MediaBadge from './MediaBadge.svelte';
	import type { TitleSuggestion } from '$lib/types';

	let {
		label,
		placeholder = 'e.g. Con Air',
		selected = $bindable(null),
		onselect,
		clearOnSelect = false
	}: {
		label: string;
		placeholder?: string;
		selected?: TitleSuggestion | null;
		/** Called on every pick. With `clearOnSelect` this makes an "add" box. */
		onselect?: (title: TitleSuggestion) => void;
		clearOnSelect?: boolean;
	} = $props();

	let query = $state('');
	let results = $state<TitleSuggestion[]>([]);
	let open = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let activeIndex = $state(-1);
	let container: HTMLDivElement;
	const inputId = $derived(`title-search-${label.toLowerCase().replace(/\W+/g, '-')}`);

	const DEBOUNCE_MS = 300;
	const MIN_CHARS = 2;

	/** Queries already answered this session — backspacing never refetches. */
	const cache = new Map<string, TitleSuggestion[]>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	/** Only the newest request is allowed to write state. */
	let seq = 0;

	function onInput() {
		selected = null;
		error = null;
		clearTimeout(timer);

		const q = query.trim();
		if (q.length < MIN_CHARS) {
			controller?.abort();
			seq++;
			results = [];
			open = false;
			loading = false;
			return;
		}

		const cached = cache.get(q.toLowerCase());
		if (cached) {
			seq++;
			results = cached;
			activeIndex = cached.length ? 0 : -1;
			loading = false;
			open = true;
			return;
		}

		loading = true;
		open = true;
		timer = setTimeout(() => search(q), DEBOUNCE_MS);
	}

	async function search(q: string) {
		const mine = ++seq;
		controller?.abort();
		controller = new AbortController();

		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
				signal: controller.signal
			});
			const data = await res.json();
			if (mine !== seq) return;
			if (!res.ok) throw new Error(data.error ?? 'Search failed.');

			cache.set(q.toLowerCase(), data.results);
			results = data.results;
			activeIndex = data.results.length ? 0 : -1;
		} catch (e) {
			if (mine !== seq || (e as Error).name === 'AbortError') return;
			error = (e as Error).message;
			results = [];
		} finally {
			if (mine === seq) loading = false;
		}
	}

	function choose(title: TitleSuggestion) {
		onselect?.(title);
		open = false;
		activeIndex = -1;

		if (clearOnSelect) {
			selected = null;
			query = '';
			results = [];
			return;
		}
		selected = title;
		query = title.year ? `${title.title} (${title.year})` : title.title;
	}

	function clear() {
		clearTimeout(timer);
		controller?.abort();
		seq++;
		selected = null;
		query = '';
		results = [];
		open = false;
		loading = false;
		error = null;
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			open = false;
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			if (!results.length) return;
			event.preventDefault();
			open = true;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			activeIndex = (activeIndex + step + results.length) % results.length;
			return;
		}
		if (event.key === 'Enter' && open && activeIndex >= 0) {
			event.preventDefault();
			choose(results[activeIndex]);
		}
	}

	function onFocusOut(event: FocusEvent) {
		if (!container.contains(event.relatedTarget as Node | null)) open = false;
	}

	/**
	 * Reflect a selection made from outside into the visible input.
	 *
	 * The component owns `query` — the text in the box — while `selected` is
	 * bindable, so loading a puzzle into the builder sets the selection without
	 * the box knowing about it, and the field looks empty when it isn't. Keyed on
	 * the ref so re-selecting the same title doesn't fight the user's typing.
	 */
	let displayed = $state<string | null>(null);
	$effect(() => {
		const current = selected;
		const ref = current ? `${current.mediaType}:${current.id}` : null;
		if (ref === displayed) return;
		displayed = ref;
		if (current) query = current.year ? `${current.title} (${current.year})` : current.title;
	});

	const ratings = (votes: number) => {
		if (votes === 0) return 'unrated';
		if (votes < 1000) return `${votes} ratings`;
		return `${(votes / 1000).toFixed(votes < 10000 ? 1 : 0)}k ratings`;
	};
</script>

<div class="relative" bind:this={container} onfocusout={onFocusOut}>
	<label for={inputId} class="mb-1.5 block text-xs font-semibold tracking-widest text-slate-400 uppercase">
		{label}
	</label>

	<div class="relative">
		<input
			id={inputId}
			type="text"
			role="combobox"
			aria-expanded={open}
			aria-controls="{inputId}-listbox"
			autocomplete="off"
			spellcheck="false"
			bind:value={query}
			oninput={onInput}
			onkeydown={onKeydown}
			onfocus={() => {
				if (results.length && !selected) open = true;
			}}
			{placeholder}
			class="w-full rounded-xl border border-slate-700 bg-slate-900/80 py-2.5 pr-10 pl-3.5 text-slate-100 placeholder-slate-500 shadow-inner transition outline-none focus:border-amber-400/70 focus:ring-2 focus:ring-amber-400/20"
		/>

		{#if loading}
			<span
				class="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-600 border-t-amber-400"
			></span>
		{:else if query}
			<button
				type="button"
				onclick={clear}
				aria-label="Clear {label}"
				class="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg px-2 py-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
			>
				&times;
			</button>
		{/if}
	</div>

	{#if error}
		<p class="mt-2 text-sm text-rose-400">{error}</p>
	{/if}

	{#if open}
		<ul
			id="{inputId}-listbox"
			role="listbox"
			class="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50"
		>
			{#if results.length === 0 && !loading}
				<li class="px-4 py-3 text-sm text-slate-500">Nothing found.</li>
			{/if}
			{#each results as title, i (`${title.mediaType}:${title.id}`)}
				<li role="option" aria-selected={i === activeIndex}>
					<button
						type="button"
						onclick={() => choose(title)}
						onmouseenter={() => (activeIndex = i)}
						class="flex w-full items-center gap-3 px-3 py-2 text-left transition {i === activeIndex
							? 'bg-slate-800'
							: ''}"
					>
						{#if posterUrl(title.posterPath, 'w92')}
							<img
								src={posterUrl(title.posterPath, 'w92')}
								alt=""
								loading="lazy"
								class="h-14 w-10 shrink-0 rounded object-cover"
							/>
						{:else}
							<span class="h-14 w-10 shrink-0 rounded bg-slate-800"></span>
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate text-slate-100">{title.title}</span>
							<span class="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
								{title.year ?? '—'}
								<MediaBadge mediaType={title.mediaType} />
								{#if title.voteCount !== undefined}
									<!-- How many people have rated it: the quickest read on whether
									     anyone has heard of the thing you're about to pick. -->
									<span class="text-xs {title.voteCount < 50 ? 'text-slate-600' : 'text-slate-500'}">
										{ratings(title.voteCount)}
									</span>
								{/if}
							</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
