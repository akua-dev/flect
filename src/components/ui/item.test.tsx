// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from '@effect/vitest';
import { cleanup, render } from '@testing-library/react';
import { Effect } from 'effect';
import { Item, ItemGroup, ItemSeparator } from './item';

afterEach(cleanup);

describe('ItemGroup/Item semantics', () => {
	it.effect('ItemGroup is a real <ul>, with Item/ItemSeparator rendering as <li>', () =>
		Effect.sync(() => {
			const { container } = render(
				<ItemGroup>
					<Item>one</Item>
					<ItemSeparator />
					<Item>two</Item>
				</ItemGroup>
			);
			const list = container.querySelector('ul[data-slot="item-group"]');
			expect(list).not.toBeNull();
			expect(list?.getAttribute('role')).toBeNull();
			expect(list?.children).toHaveLength(3);
			for (const child of Array.from(list?.children ?? [])) {
				expect(child.tagName).toBe('LI');
			}
		})
	);

	it.effect('Item used outside an ItemGroup keeps rendering a plain <div>', () =>
		Effect.sync(() => {
			const { container } = render(<Item>standalone</Item>);
			expect(container.querySelector('[data-slot="item"]')?.tagName).toBe('DIV');
		})
	);
});
