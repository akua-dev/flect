// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStickyFollow } from './use-sticky-follow';

afterEach(cleanup);

function Harness() {
	const [role, setRole] = useState<'app' | 'shaper'>('app');
	const [counts, setCounts] = useState({ app: 1, shaper: 1 });
	const follow = useStickyFollow(role, `${role}-${counts[role]}`);
	return (
		<>
			<button
				onClick={() =>
					setCounts((current) => ({
						...current,
						[role]: current[role] + 1
					}))
				}
				type='button'
			>
				Append
			</button>
			<button
				onClick={() => setRole((current) => (current === 'app' ? 'shaper' : 'app'))}
				type='button'
			>
				Switch
			</button>
			<div aria-label='Timeline' onScroll={follow.onScroll} ref={follow.containerRef} role='log'>
				{Array.from({ length: counts[role] }, (_, index) => `${role}-${index}`).map((item) => (
					<p key={item}>{item}</p>
				))}
			</div>
			{!follow.following && (
				<button onClick={follow.jumpToLatest} type='button'>
					{`Jump to latest (${follow.unreadCount})`}
				</button>
			)}
		</>
	);
}

const setScrollGeometry = (
	element: HTMLElement,
	geometry: {
		readonly clientHeight: number;
		readonly scrollHeight: number;
		readonly scrollTop: number;
	}
) => {
	Object.defineProperties(element, {
		clientHeight: { configurable: true, value: geometry.clientHeight },
		scrollHeight: { configurable: true, value: geometry.scrollHeight },
		scrollTop: {
			configurable: true,
			writable: true,
			value: geometry.scrollTop
		}
	});
};

describe('useStickyFollow', () => {
	it('does not pull a reader away and makes new content explicit', async () => {
		const user = userEvent.setup();
		render(<Harness />);
		const timeline = screen.getByRole('log', { name: 'Timeline' });
		setScrollGeometry(timeline, {
			clientHeight: 100,
			scrollHeight: 300,
			scrollTop: 80
		});

		fireEvent.scroll(timeline);
		await user.click(screen.getByRole('button', { name: 'Append' }));

		expect(timeline.scrollTop).toBe(80);
		const jump = screen.getByRole('button', { name: 'Jump to latest (1)' });
		const focus = vi.spyOn(timeline, 'focus');
		await user.click(jump);

		expect(timeline.scrollTop).toBe(300);
		expect(focus).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: /Jump to latest/ })).not.toBeInTheDocument();
	});

	it('remembers follow state and scroll position independently per role', async () => {
		const user = userEvent.setup();
		render(<Harness />);
		const timeline = screen.getByRole('log', { name: 'Timeline' });
		setScrollGeometry(timeline, {
			clientHeight: 100,
			scrollHeight: 300,
			scrollTop: 70
		});
		fireEvent.scroll(timeline);

		await user.click(screen.getByRole('button', { name: 'Switch' }));
		expect(timeline.scrollTop).toBe(300);

		timeline.scrollTop = 90;
		fireEvent.scroll(timeline);
		await user.click(screen.getByRole('button', { name: 'Switch' }));
		expect(timeline.scrollTop).toBe(70);
	});
});
