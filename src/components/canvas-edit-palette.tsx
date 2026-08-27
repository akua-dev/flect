import type { CSSProperties } from 'react';
import type { CanvasSelectionRect } from '../../shared/canvas-selection';

export type CanvasEditAction = 'move-earlier' | 'move-later' | 'smaller' | 'larger';

interface CanvasViewport {
	readonly width: number;
	readonly height: number;
}

interface CanvasPalettePosition {
	readonly left: number;
	readonly top: number;
	readonly placement: 'above' | 'below';
}

const paletteWidth = 420;
const paletteHeight = 42;
const paletteGap = 8;
const viewportInset = 12;

const clamp = (value: number, minimum: number, maximum: number) =>
	Math.max(minimum, Math.min(value, maximum));

export const placeCanvasEditPalette = (
	rect: CanvasSelectionRect,
	viewport: CanvasViewport
): CanvasPalettePosition => {
	const maximumLeft = Math.max(viewportInset, viewport.width - paletteWidth - viewportInset);
	const left = clamp(rect.x + rect.width / 2 - paletteWidth / 2, viewportInset, maximumLeft);
	const below = rect.y + rect.height + paletteGap;
	const fitsBelow = below + paletteHeight + viewportInset <= viewport.height;
	if (fitsBelow) {
		return { left, top: below, placement: 'below' };
	}
	return {
		left,
		top: clamp(
			rect.y - paletteHeight - paletteGap,
			viewportInset,
			Math.max(viewportInset, viewport.height - paletteHeight - viewportInset)
		),
		placement: 'above'
	};
};

export interface CanvasEditPaletteProps {
	readonly busy?: boolean;
	readonly coordinateSpace?: 'absolute' | 'fixed';
	readonly label: string;
	readonly onAction: (action: CanvasEditAction) => void;
	readonly onClear: () => void;
	readonly rect: CanvasSelectionRect;
	readonly viewport?: CanvasViewport;
}

export function CanvasEditPalette({
	busy = false,
	coordinateSpace = 'fixed',
	label,
	onAction,
	onClear,
	rect,
	viewport = {
		width: globalThis.innerWidth,
		height: globalThis.innerHeight
	}
}: CanvasEditPaletteProps) {
	const position = placeCanvasEditPalette(rect, viewport);
	const style: CSSProperties = {
		left: position.left,
		position: coordinateSpace,
		top: position.top
	};
	return (
		<div
			aria-label={`Edit ${label}`}
			className='canvas-edit-palette'
			data-placement={position.placement}
			role='toolbar'
			style={style}
		>
			<span className='canvas-edit-palette__target' role='status'>
				{label}
			</span>
			<button
				aria-label='Move earlier'
				disabled={busy}
				onClick={() => onAction('move-earlier')}
				type='button'
			>
				Earlier
			</button>
			<button
				aria-label='Move later'
				disabled={busy}
				onClick={() => onAction('move-later')}
				type='button'
			>
				Later
			</button>
			<button disabled={busy} onClick={() => onAction('smaller')} type='button'>
				Smaller
			</button>
			<button disabled={busy} onClick={() => onAction('larger')} type='button'>
				Larger
			</button>
			<button aria-label='Clear canvas selection' onClick={onClear} type='button'>
				Clear
			</button>
		</div>
	);
}

export default CanvasEditPalette;
