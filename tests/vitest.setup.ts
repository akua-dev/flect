if (globalThis.ResizeObserver === undefined) {
	globalThis.ResizeObserver = class ResizeObserverStub {
		disconnect() {}

		observe() {}

		unobserve() {}
	};
}
