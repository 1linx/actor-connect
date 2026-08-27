<script lang="ts">
	import { drag } from '$lib/drag.svelte';
	import TitleNode from './TitleNode.svelte';
	import type { TitleSummary } from '$lib/types';

	let {
		index,
		filled = null,
		wrong = false,
		locked = false,
		open = false,
		onplace
	}: {
		index: number;
		/** What sits here: a correct placement, or the answer once the game is over. */
		filled?: { title: TitleSummary; earned: boolean } | null;
		/** Shake it — a wrong title was just dropped here. */
		wrong?: boolean;
		/** Game over: no more placements. */
		locked?: boolean;
		/** The one slot that can be filled next. Every other empty slot is inert. */
		open?: boolean;
		onplace: (slot: number) => void;
	} = $props();

	const armed = $derived(open && !filled && !locked && drag.held !== null);
	const over = $derived(armed && drag.over === index);
	const hint = $derived(
		drag.dragging ? 'Drop it here' : armed ? 'Tap to place here' : 'Which film links these two?'
	);
</script>

{#if filled}
	<TitleNode title={filled.title} tone={filled.earned ? 'placed' : 'given'} />
{:else if !open}
	<!-- Not this slot's turn. No `data-slot`, so a drag can't land here, and not
	     a button, so it can't be tapped or tabbed to. The single lit slot is what
	     tells the player the chain is built in order. -->
	<div
		class="chain-row w-full rounded-xl border-2 border-dashed border-slate-800 py-2.5 opacity-40"
	>
		<span class="flex justify-center">
			<span
				class="grid size-8 place-items-center rounded-md border border-dashed border-slate-700 text-base font-bold text-slate-700"
			>
				?
			</span>
		</span>
		<span class="sr-only">Slot {index + 1}, not yet in play</span>
	</div>
{:else}
	<!-- Empty slots stay short so the whole chain fits a phone screen; they grow
	     into a full poster card the moment the right film lands. -->
	<button
		type="button"
		data-slot={index}
		disabled={locked}
		aria-label="Slot {index + 1}{armed ? `. Place ${drag.held?.title} here` : ''}"
		onclick={() => armed && onplace(index)}
		class="chain-row w-full rounded-xl border-2 border-dashed py-2.5 text-left transition
			{wrong ? 'animate-shake border-rose-500/70 bg-rose-500/10' : ''}
			{over
			? 'border-amber-400 bg-amber-400/15 shadow-lg shadow-amber-400/10'
			: armed
				? 'border-amber-400/50 bg-amber-400/5'
				: 'border-slate-700/70 bg-slate-900/30'}
			{locked ? 'opacity-60' : ''}"
		style="touch-action: manipulation"
	>
		<span class="flex justify-center">
			<span
				class="grid size-8 place-items-center rounded-md border border-dashed text-base font-bold
					{over ? 'border-amber-400/60 text-amber-300' : 'border-slate-700 text-slate-600'}"
			>
				?
			</span>
		</span>
		<span
			class="min-w-0 truncate text-sm {over
				? 'text-amber-200'
				: armed
					? 'text-amber-200/80'
					: 'text-slate-500'}"
		>
			{hint}
		</span>
	</button>
{/if}
