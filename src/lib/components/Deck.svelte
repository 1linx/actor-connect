<script lang="ts">
	import { drag } from '$lib/drag.svelte';
	import DeckCard from './DeckCard.svelte';
	import { titleRef, type TitleSummary } from '$lib/types';

	let {
		hand,
		locked = false,
		onplace
	}: {
		hand: TitleSummary[];
		locked?: boolean;
		onplace: (slot: number, title: TitleSummary) => void;
	} = $props();
</script>

<div
	class="sticky bottom-0 z-30 border-t border-slate-800 bg-slate-950/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
>
	<div class="mb-2 flex items-baseline justify-between gap-3 px-1">
		<p class="text-[0.65rem] font-bold tracking-[0.18em] text-slate-500 uppercase">
			The films
		</p>
		<p class="text-xs text-slate-500">
			{#if locked}
				Round over
			{:else if drag.held}
				Now tap an open slot
			{:else}
				Drag one up, or tap it
			{/if}
		</p>
	</div>

	{#if hand.length}
		<!-- Cards share the row and grow to fill it, which a short chain now has
		     room for. The card's own min/max width does the rest: a long chain
		     bottoms out at 4rem and the row scrolls sideways instead, and a
		     nearly-finished one stops at 7rem rather than ballooning.
		     `safe center` keeps a part-empty row centred *without* the usual
		     centred-overflow trap where the first card becomes unreachable; where
		     it isn't supported the row just starts from the left.
		     Cards allow horizontal panning, so a sideways swipe scrolls and an
		     upward drag picks the card up. -->
		<div
			class="flex gap-2.5 overflow-x-auto px-1 pb-1"
			style="justify-content: safe center"
		>
			{#each hand as title (titleRef(title))}
				<DeckCard {title} {locked} {onplace} />
			{/each}
		</div>
	{:else}
		<p class="px-1 pb-2 text-sm text-slate-500">Nothing left to place.</p>
	{/if}
</div>
