<script lang="ts">
	import { profileUrl } from '$lib/images';
	import type { PuzzleLink } from '$lib/types';

	let {
		index,
		link = null,
		fresh = false,
		earned = true
	}: {
		index: number;
		/** Null until the titles either side of it are both on the board. */
		link?: PuzzleLink | null;
		/** Just revealed — worth animating in. */
		fresh?: boolean;
		/** False when the answer was handed over rather than earned. */
		earned?: boolean;
	} = $props();

	const face = $derived(link ? profileUrl(link.profilePath, 'w185') : null);
	const tone = $derived(!link ? 'locked' : earned ? 'earned' : 'given');
</script>

<!-- `chain-row` puts the face on the rail that runs down the chain. -->
<div class="chain-row relative py-1">
	<div class="flex justify-center">
		{#if link}
			<span
				class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-slate-800
					{tone === 'earned' ? 'border-amber-400/70' : 'border-slate-700'}
					{fresh ? 'animate-pop-in' : ''}"
			>
				{#if face}
					<img
						src={face}
						alt=""
						loading="lazy"
						draggable="false"
						class="size-full object-cover {tone === 'given' ? 'grayscale' : ''}"
					/>
				{:else}
					<span class="text-xs font-bold text-slate-400">{link.name.slice(0, 1)}</span>
				{/if}
			</span>
		{:else}
			<span
				class="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-slate-700 bg-slate-950 text-sm font-bold text-slate-600"
			>
				?
			</span>
		{/if}
	</div>

	<div class="min-w-0">
		{#if link}
			<p
				class="truncate font-semibold {tone === 'earned' ? 'text-amber-200' : 'text-slate-400'}
					{fresh ? 'animate-pop-in' : ''}"
			>
				{link.name}
			</p>
			{#if link.roles}
				<p class="truncate text-xs text-slate-500">
					{link.roles[0] || 'uncredited'} <span class="text-slate-600">→</span>
					{link.roles[1] || 'uncredited'}
				</p>
			{/if}
		{:else}
			<p class="text-xs tracking-wide text-slate-600">Connection {index + 1}</p>
		{/if}
	</div>
</div>
