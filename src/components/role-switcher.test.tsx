// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from '@effect/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleSwitcher } from './role-switcher';

afterEach(cleanup);

describe('RoleSwitcher', () => {
	it('announces the explicit Use and Shape target before switching', async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(
			<RoleSwitcher disabled={false} onChange={onChange} target='shape' useDisabled={false} />
		);

		expect(screen.getByRole('button', { name: 'Shape · Shaper' })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await user.click(screen.getByRole('button', { name: 'Use · App Agent' }));
		expect(onChange).toHaveBeenCalledWith('use');
	});

	it('can block unavailable Use while leaving Shape reachable', () => {
		render(<RoleSwitcher disabled={false} onChange={() => undefined} target='shape' useDisabled />);

		expect(screen.getByRole('button', { name: 'Shape · Shaper' })).toBeEnabled();
		expect(screen.getByRole('button', { name: 'Use · App Agent' })).toBeDisabled();
	});
});
