import type { Puzzle } from './types';

/** Namespace on every message, in both directions, so hosts can filter cleanly. */
export const CHANNEL = 'actor-connect';

export type OutboundType =
	/** Sent once the board is up. Payload: `{ puzzleId, name, slots, strikeLimit }`. */
	| 'ready'
	/** After every placement. Payload: `{ placed, slots, strikes, strikesLeft }`. */
	| 'progress'
	/** A wrong answer. Payload: `{ strikes, strikesLeft }`. */
	| 'strike'
	/** A connection earned. Payload: `{ index, name, personId }`. */
	| 'reveal'
	/** Chain completed. Payload: `{ strikes, elapsedMs }`. */
	| 'won'
	/** Three strikes. Payload: `{ elapsedMs }`. */
	| 'lost'
	/** The player asked to see the answer. */
	| 'revealed'
	/** Content height in CSS px, for sizing the iframe. Payload: `{ height }`. */
	| 'height';

export interface Outbound {
	source: typeof CHANNEL;
	type: OutboundType;
	payload?: Record<string, unknown>;
}

/** What a host page may ask the game to do. */
export type Inbound =
	| { type: 'restart' }
	/** Switch puzzle: by id from this app's library, or a whole puzzle inline. */
	| { type: 'load'; puzzleId?: string; puzzle?: Puzzle };

export const isEmbedded = () => typeof window !== 'undefined' && window.parent !== window;

interface BridgeOptions {
	/**
	 * The host's origin, from `?parentOrigin=`. Messages are only accepted from
	 * it and only sent to it. Without it we fall back to `*`, which is fine for
	 * a game with nothing private in it but worth setting in production.
	 */
	parentOrigin?: string | null;
	onCommand?: (message: Inbound) => void;
	/** Report content height as it changes, for auto-sizing the iframe. */
	trackHeight?: boolean;
}

/**
 * Talks to the page we're iframed into.
 *
 * Deliberately one-way-ish: the game tells the host what happened, the host can
 * tell the game which puzzle to run. Nothing here is required for the game to
 * work standalone — if there's no parent, `send` is a no-op.
 */
export function createBridge({ parentOrigin, onCommand, trackHeight = true }: BridgeOptions) {
	const target = parentOrigin || '*';
	const active = isEmbedded();

	const send = (type: OutboundType, payload?: Record<string, unknown>) => {
		if (!active) return;
		const message: Outbound = { source: CHANNEL, type, ...(payload ? { payload } : {}) };
		window.parent.postMessage(message, target);
	};

	const onMessage = (event: MessageEvent) => {
		if (event.source !== window.parent) return;
		if (parentOrigin && event.origin !== parentOrigin) return;
		const data = event.data as (Inbound & { source?: string }) | null;
		if (!data || typeof data !== 'object') return;
		// Accept our own namespace, or a bare {type} for hosts that keep it terse.
		if (data.source && data.source !== CHANNEL) return;
		if (data.type === 'restart' || data.type === 'load') onCommand?.(data);
	};

	let observer: ResizeObserver | undefined;
	let frame = 0;
	let lastHeight = -1;

	if (active && typeof window !== 'undefined') {
		window.addEventListener('message', onMessage);

		if (trackHeight && 'ResizeObserver' in window) {
			observer = new ResizeObserver(() => {
				// Coalesce the burst a layout change produces into one message.
				cancelAnimationFrame(frame);
				frame = requestAnimationFrame(() => {
					const height = Math.ceil(document.documentElement.scrollHeight);
					if (height !== lastHeight) {
						lastHeight = height;
						send('height', { height });
					}
				});
			});
			observer.observe(document.documentElement);
		}
	}

	return {
		send,
		active,
		destroy() {
			if (!active) return;
			window.removeEventListener('message', onMessage);
			cancelAnimationFrame(frame);
			observer?.disconnect();
		}
	};
}
