<script lang="ts">
	import MediaBadge from './MediaBadge.svelte';
	import Poster from './Poster.svelte';
	import type { TitleSummary } from '$lib/types';

	let {
		title,
		label = null,
		tone = 'placed'
	}: {
		title: TitleSummary;
		/** Small chip above the title, e.g. START. */
		label?: string | null;
		/** `anchor` for the two given titles, `placed` when earned, `given` when it was handed over. */
		tone?: 'anchor' | 'placed' | 'given';
	} = $props();

	const ring = $derived(
		{
			anchor: 'border-slate-700 bg-slate-900',
			placed: 'border-emerald-500/40 bg-emerald-500/5',
			given: 'border-slate-800 bg-slate-900/40 opacity-70'
		}[tone]
	);
</script>

<div class="chain-row relative rounded-xl border py-2 {ring}">
	<Poster {title} size="w154" class={tone === 'given' ? 'grayscale' : ''} />
	<div class="min-w-0">
		{#if label}
			<p class="mb-0.5 text-[0.6rem] font-bold tracking-[0.18em] text-slate-500 uppercase">
				{label}
			</p>
		{/if}
		<p class="truncate font-semibold text-slate-100">{title.title}</p>
		<p class="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
			{title.year ?? '—'}
			{#if title.mediaType === 'tv'}<MediaBadge mediaType={title.mediaType} />{/if}
		</p>
	</div>
</div>
