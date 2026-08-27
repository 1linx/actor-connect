<script lang="ts">
	let { strikes, limit }: { strikes: number; limit: number } = $props();
</script>

<div class="flex items-center gap-1.5" aria-live="polite">
	<span class="sr-only">{strikes} of {limit} strikes used</span>
	{#each { length: limit }, i}
		<!-- Unspent strikes are hollow, so a full row doesn't read as three
		     already-used marks. -->
		<span
			aria-hidden="true"
			class="grid size-5 place-items-center rounded-full border text-xs font-bold transition
				{i < strikes
				? 'animate-pop-in border-rose-500/50 bg-rose-500/20 text-rose-300'
				: 'border-slate-700'}"
		>
			{i < strikes ? '✕' : ''}
		</span>
	{/each}
</div>
