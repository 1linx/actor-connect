import { titleRef, type TitleSummary } from './types';

/** Movement, in px, before a press becomes a drag rather than a tap. */
const DRAG_THRESHOLD = 8;

/** Which slot, if any, sits under the given viewport point. */
function slotAt(x: number, y: number): number | null {
	const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot]');
	if (!el) return null;
	const index = Number(el.dataset.slot);
	return Number.isInteger(index) ? index : null;
}

/**
 * One pointer gesture, two ways to answer.
 *
 * Touch devices get no HTML5 drag-and-drop, so this is built on pointer events
 * and works the same for finger, mouse and pen. A press that moves is a drag;
 * a press that doesn't is a tap, which leaves the card *held* so it can be
 * placed by tapping a slot instead. That second path is also the one keyboard
 * users take, and it's the reason nothing here depends on being able to drag.
 */
class Dragger {
	/** The card currently picked up — mid-drag, or selected by tap. */
	held = $state<TitleSummary | null>(null);
	/** True once a press has moved far enough to count as a drag. */
	dragging = $state(false);
	/** Viewport position of the pointer, for placing the drag ghost. */
	x = $state(0);
	y = $state(0);
	/** Slot under the pointer, highlighted as a drop target. */
	over = $state<number | null>(null);

	#startX = 0;
	#startY = 0;
	#armed = false;

	isHeld(title: TitleSummary) {
		return this.held !== null && titleRef(this.held) === titleRef(title);
	}

	press(title: TitleSummary, event: PointerEvent) {
		this.#startX = event.clientX;
		this.#startY = event.clientY;
		this.#armed = true;
		this.held = title;
		this.x = event.clientX;
		this.y = event.clientY;
		// Keep receiving moves even when the finger leaves the card.
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
	}

	move(event: PointerEvent) {
		if (!this.#armed) return;
		const travelled = Math.hypot(event.clientX - this.#startX, event.clientY - this.#startY);
		if (!this.dragging && travelled < DRAG_THRESHOLD) return;

		this.dragging = true;
		this.x = event.clientX;
		this.y = event.clientY;
		this.over = slotAt(event.clientX, event.clientY);
	}

	/** Ends the gesture. Returns the slot to drop on, or null if it was a tap. */
	release(): number | null {
		const target = this.dragging ? this.over : null;
		this.#armed = false;
		this.dragging = false;
		this.over = null;
		return target;
	}

	cancel() {
		this.#armed = false;
		this.dragging = false;
		this.over = null;
		this.held = null;
	}

	clear() {
		this.held = null;
	}

	/** Toggle selection from a keyboard or non-pointer activation. */
	toggle(title: TitleSummary) {
		this.held = this.isHeld(title) ? null : title;
	}
}

export const drag = new Dragger();
