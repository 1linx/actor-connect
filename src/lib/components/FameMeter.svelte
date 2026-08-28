<script lang="ts">
	let { popularity, label = 'Fame' }: { popularity: number; label?: string } = $props();

	/**
	 * TMDB's person popularity as five segments.
	 *
	 * Log-scaled, because the numbers are compressed: across Con Air's cast the
	 * whole range is 0.3 (an extra with one line) to 9.6 (Nicolas Cage), and a
	 * linear meter would show four segments of nothing.
	 */
	const filled = $derived(
		Math.min(5, Math.max(1, Math.round(Math.log2(Math.max(0, popularity) + 1) * 1.6)))
	);
</script>

<span class="inline-flex items-center gap-0.5" title="{label}: {popularity.toFixed(1)}">
	<span class="sr-only">{label} {filled} of 5</span>
	{#each { length: 5 }, i}
		<span
			aria-hidden="true"
			class="h-2.5 w-1 rounded-full {i < filled ? 'bg-amber-400/80' : 'bg-slate-700'}"
		></span>
	{/each}
</span>
