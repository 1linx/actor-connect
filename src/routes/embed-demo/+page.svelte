<script lang="ts">
	import { CHANNEL, type Outbound } from '$lib/embed';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * Stands in for the Laravel page. Everything here is what the host side
	 * would do: size the frame from `height`, react to `won`/`lost`, and push
	 * commands back in.
	 */
	let frame = $state<HTMLIFrameElement | null>(null);
	let height = $state(720);
	let log = $state<Array<{ type: string; detail: string }>>([]);
	let origin = $state('');

	$effect(() => {
		origin = window.location.origin;
	});

	const src = $derived(
		origin ? `/?embed=1&parentOrigin=${encodeURIComponent(origin)}` : null
	);

	function onMessage(event: MessageEvent) {
		if (event.origin !== window.location.origin) return;
		const data = event.data as Outbound | null;
		if (data?.source !== CHANNEL) return;

		if (data.type === 'height' && typeof data.payload?.height === 'number') {
			height = data.payload.height;
		}
		log = [
			{ type: data.type, detail: data.payload ? JSON.stringify(data.payload) : '' },
			...log
		].slice(0, 30);
	}

	function command(message: Record<string, unknown>) {
		frame?.contentWindow?.postMessage({ source: CHANNEL, ...message }, window.location.origin);
	}
</script>

<svelte:head><title>Embedding Actor Connect</title></svelte:head>
<svelte:window onmessage={onMessage} />

<main class="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
	<div>
		<h1 class="text-xl font-bold text-slate-50">Host page</h1>
		<p class="mt-1 mb-4 text-sm text-slate-400">
			The game below is in an iframe. The frame's height follows the game's content, and every
			event it emits is listed on the right.
		</p>

		{#if src}
			<iframe
				bind:this={frame}
				title="Actor Connect"
				{src}
				style="height: {height}px"
				class="w-full rounded-xl border border-slate-800 bg-slate-900 transition-[height] duration-200"
			></iframe>
		{/if}
	</div>

	<aside class="space-y-4">
		<div>
			<h2 class="mb-2 text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
				Send a command
			</h2>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => command({ type: 'restart' })}
					class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500"
				>
					restart
				</button>
				{#each data.puzzles as puzzle (puzzle.id)}
					<button
						type="button"
						onclick={() => command({ type: 'load', puzzleId: puzzle.id })}
						class="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500"
					>
						load {puzzle.id}
					</button>
				{/each}
			</div>
		</div>

		<div>
			<h2 class="mb-2 text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
				Events ({log.length})
			</h2>
			<ul class="max-h-96 space-y-1 overflow-y-auto rounded-xl border border-slate-800 p-2 font-mono text-[0.7rem]">
				{#each log as entry, i (i)}
					<li class="text-slate-400">
						<span class="text-amber-300">{entry.type}</span>
						{entry.detail}
					</li>
				{:else}
					<li class="p-2 text-slate-600">Nothing yet — play a move.</li>
				{/each}
			</ul>
		</div>

		<p class="text-xs leading-relaxed text-slate-500">
			In Laravel this is a Blade view with the same listener. Point the iframe at the deployed
			origin and pass <code>parentOrigin</code> so the game only talks to your page.
		</p>
	</aside>
</main>
