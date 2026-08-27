import { installMemoryFs } from '@riftydev/vfs/internal';
import { Schema } from 'effect';
import { installRiftyCapabilityBoundary } from './rifty-capability-boundary';

const RiftyWorkerReadyMessage = Schema.Struct({
	type: Schema.Literal('ready')
});
const isRiftyWorkerReadyMessage = Schema.is(RiftyWorkerReadyMessage);

const forceMemoryVfs = (): void => {
	Object.defineProperty(globalThis, 'crossOriginIsolated', {
		configurable: false,
		enumerable: false,
		value: false,
		writable: false
	});
};

forceMemoryVfs();
installMemoryFs();

const postMessage = globalThis.postMessage.bind(globalThis);
function forwardPostMessage(
	message: unknown,
	targetOrigin: string,
	transfer?: Transferable[]
): void;
function forwardPostMessage(message: unknown, options?: WindowPostMessageOptions): void;
function forwardPostMessage(message: unknown, transfer: Transferable[]): void;
function forwardPostMessage(
	message: unknown,
	optionsOrTarget?: string | Transferable[] | WindowPostMessageOptions,
	transfer?: Transferable[]
): void {
	if (isRiftyWorkerReadyMessage(message)) {
		installRiftyCapabilityBoundary();
	}
	if (typeof optionsOrTarget === 'string') {
		postMessage(message, optionsOrTarget, transfer);
	} else if (Array.isArray(optionsOrTarget)) {
		postMessage(message, optionsOrTarget);
	} else {
		postMessage(message, optionsOrTarget);
	}
}

globalThis.postMessage = forwardPostMessage;
await import('@riftydev/runtime-js/worker');
