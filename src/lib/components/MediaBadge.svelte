<script lang="ts">
	import type { MediaType } from '$lib/types';

	let { mediaType }: { mediaType: MediaType } = $props();
</script>

<span
	class="rounded px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide uppercase {mediaType ===
	'tv'
		? 'bg-sky-400/15 text-sky-300'
		: 'bg-amber-400/15 text-amber-300'}"
>
	{mediaType === 'tv' ? 'TV' : 'Film'}
</span>
