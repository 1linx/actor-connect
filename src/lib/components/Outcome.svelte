<script lang="ts">
	import type { Status } from '$lib/game.svelte';

	let {
		status,
		strikes,
		elapsedMs = null,
		onrestart,
		onnext = null
	}: {
		status: Status;
		strikes: number;
		elapsedMs?: number | null;
		onrestart: () => void;
		/** Only offered when the library has more than one puzzle. */
		onnext?: (() => void) | null;
	} = $props();

	const clock = $derived.by(() => {
		if (elapsedMs === null) return null;
		const total = Math.round(elapsedMs / 1000);
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
	});

	const copy = $derived(
		{
			won: {
				title: 'Chain complete',
				body:
					strikes === 0
						? 'Clean run — not a single wrong turn.'
						: `${strikes} wrong turn${strikes === 1 ? '' : 's'} along the way.`,
				tone: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
			},
			lost: {
				title: 'Out of strikes',
				body: 'Here is how the chain actually ran.',
				tone: 'border-rose-500/40 bg-rose-500/10 text-rose-200'
			},
			revealed: {
				title: 'Answer revealed',
				body: 'No shame in it. The chain in full:',
				tone: 'border-slate-700 bg-slate-900 text-slate-300'
			},
			playing: { title: '', body: '', tone: '' }
		}[status]
	);
</script>

<div class="animate-pop-in rounded-xl border px-4 py-3 {copy.tone}">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<p class="font-bold">{copy.title}</p>
			<p class="mt-0.5 text-sm opacity-80">
				{copy.body}{#if clock && status === 'won'}<span class="opacity-70">
						&middot; {clock}</span
					>{/if}
			</p>
		</div>
		<div class="flex gap-2">
			<button
				type="button"
				onclick={onrestart}
				class="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-semibold transition hover:bg-white/20"
			>
				Play again
			</button>
			{#if onnext}
				<button
					type="button"
					onclick={onnext}
					class="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
				>
					Next puzzle
				</button>
			{/if}
		</div>
	</div>
</div>
