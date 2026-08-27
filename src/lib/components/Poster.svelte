<script lang="ts">
	import { posterUrl } from '$lib/images';
	import type { TitleSummary } from '$lib/types';

	let {
		title,
		size = 'w185',
		sizes = null,
		class: klass = ''
	}: {
		title: TitleSummary;
		size?: string;
		/**
		 * A CSS `sizes` value. Supplying it switches the image to a srcset across
		 * TMDB's poster widths, which matters where the rendered width varies with
		 * the viewport — the deck cards stretch to fill the row, so a single fixed
		 * width is either soft on a wide screen or wasteful on a narrow one.
		 */
		sizes?: string | null;
		class?: string;
	} = $props();

	/** The TMDB poster widths worth offering. Beyond w342 is wasted on a card. */
	const WIDTHS = [92, 154, 185, 342];

	const src = $derived(posterUrl(title.posterPath, size));
	const srcset = $derived(
		sizes && title.posterPath
			? WIDTHS.map((width) => `${posterUrl(title.posterPath, `w${width}`)} ${width}w`).join(', ')
			: null
	);
</script>

{#if src}
	<img
		{src}
		srcset={srcset ?? undefined}
		sizes={sizes ?? undefined}
		alt="{title.title} poster"
		loading="lazy"
		draggable="false"
		class="aspect-[2/3] w-full rounded-lg bg-slate-800 object-cover select-none {klass}"
	/>
{:else}
	<span
		class="flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-slate-800 p-1 text-center text-[0.6rem] leading-tight text-slate-500 {klass}"
	>
		{title.title}
	</span>
{/if}
