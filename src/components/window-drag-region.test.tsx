// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from '@effect/vitest';
import { fireEvent, render } from '@testing-library/react';
import { vi } from 'vitest';

const runPromise = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../lib/runtime', () => ({
	browserRuntime: { runPromise }
}));

import { WindowDragRegion } from './window-drag-region';

afterEach(() => {
	vi.clearAllMocks();
});

describe('WindowDragRegion', () => {
	it('starts the native drag operation on primary pointer press', () => {
		const { container } = render(<WindowDragRegion />);
		const region = container.querySelector('.window-drag-region');
		expect(region).not.toBeNull();
		if (region === null) return;

		fireEvent.pointerDown(region, { button: 0 });

		expect(runPromise).toHaveBeenCalledOnce();
	});

	it('does not take over a secondary pointer press', () => {
		const { container } = render(<WindowDragRegion />);
		const region = container.querySelector('.window-drag-region');
		expect(region).not.toBeNull();
		if (region === null) return;

		fireEvent.pointerDown(region, { button: 2 });

		expect(runPromise).not.toHaveBeenCalled();
	});
});
