<script lang="ts">
	import { drag } from '$lib/drag.svelte';
	import Poster from './Poster.svelte';
	import type { TitleSummary } from '$lib/types';

	let {
		title,
		locked = false,
		onplace
	}: {
		title: TitleSummary;
		locked?: boolean;
		/** Called when this card is dropped on a slot. */
		onplace: (slot: number, title: TitleSummary) => void;
	} = $props();

	const held = $derived(drag.isHeld(title));
	const lifted = $derived(held && drag.dragging);
	/** A second tap on an already-held card puts it back down. */
	let wasHeld = false;

	function down(event: PointerEvent) {
		if (locked) return;
		wasHeld = drag.isHeld(title);
		drag.press(title, event);
	}

	function up() {
		if (locked) return;
		const slot = drag.release();
		if (slot !== null) {
			onplace(slot, title);
			drag.clear();
			return;
		}
		// A tap: leave it held, unless it already was.
		if (wasHeld) drag.clear();
	}
</script>

<button
	type="button"
	disabled={locked}
	aria-pressed={held}
	onpointerdown={down}
	onpointermove={(event) => drag.move(event)}
	onpointerup={up}
	onpointercancel={() => drag.cancel()}
	onclick={(event) => {
		// detail 0 means keyboard, where there was no pointer gesture to read.
		if (event.detail === 0 && !locked) drag.toggle(title);
	}}
	title="{title.title}{title.year ? ` (${title.year})` : ''}"
	class="max-w-28 min-w-16 flex-1 basis-0 rounded-lg text-left transition select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400
		{lifted ? 'opacity-30' : ''}
		{held && !lifted ? '-translate-y-1 ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-950' : ''}
		{locked ? 'opacity-50' : 'active:scale-95'}"
	style="touch-action: pan-x"
>
	<Poster {title} size="w185" sizes="(min-width: 480px) 7rem, 23vw" />
	<span class="mt-1 block truncate text-[0.7rem] leading-tight text-slate-400">
		{title.title}
	</span>
</button>
