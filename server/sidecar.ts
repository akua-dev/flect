import { homedir } from 'node:os';
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { BunRuntime } from '@effect/platform-bun';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, Layer } from 'effect';
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization';
import * as RpcServer from 'effect/unstable/rpc/RpcServer';
import { runFlectCliMain } from '../cli/flect';
import { FlectRpcs } from '../shared/rpc';
import { makeAgentIntegrationLayer } from '../src/lib/agent-integration';
import { BunCompiledStdioLive } from './compiled-stdio';
import { ControlBrokerLive } from './control-broker';
import { serveFlectMcp } from './mcp-adapter';
import { FlectRuntimeWithPiLive } from './pi-services';
import { makeFlectRpcHandlers } from './rpc-handlers';
import { selectSidecarMode } from './sidecar-mode';

const RuntimeLive = FlectRuntimeWithPiLive;
const AgentIntegrationLive = makeAgentIntegrationLayer(homedir()).pipe(
	Layer.provide(Layer.merge(BunFileSystem.layer, BunPath.layer))
);

const SidecarLive = RpcServer.layer(FlectRpcs).pipe(
	Layer.provide(makeFlectRpcHandlers()),
	Layer.provide(ControlBrokerLive),
	Layer.provide(AgentIntegrationLive),
	Layer.provide(RuntimeLive),
	Layer.provide(RpcServer.layerProtocolStdio),
	Layer.provide(RpcSerialization.layerNdjson),
	Layer.provide(BunCompiledStdioLive)
);

// `E` is genuinely `unknown` here, not a shortcut: the 'mcp' branch's
// `serveFlectMcp()` widens through `FlectMcpOptions.gatewayLayer`, which
// `mcp-adapter.ts` types as `Layer.Layer<FlectCommandGateway, unknown, never>`
// (an override escape hatch for tests). `runSidecar` always calls
// `serveFlectMcp()` with the default gateway, so the reachable failures are
// really `ControlBrokerError | PiOperationFailed` (from the 'rpc' branch) plus
// whatever the native gateway layer can fail with, but the static type of
// `serveFlectMcp` can't be narrowed below `unknown` from this call site. See
// the Wave 4 report's "surprising error unions" section.
//
// oxlint-disable effecttsgo/missing-effect-context -- false positive: `tsc -b`
// confirms both `SidecarLive` and `runSidecar` resolve to `R = never` (verified via an
// explicit type-probe assignment during Wave 4 verification). effecttsgo's own context
// resolution appears to collapse once the declared error channel above is `unknown`
// rather than a concrete union, and falls back to reporting a missing `any` service -
// same class of false positive as `makeControlBrokerLayer` in control-broker.ts.
const runSidecar = Effect.fn('Sidecar.run')(function* (
	argv: ReadonlyArray<string>
): Effect.fn.Return<undefined, unknown> {
	const selected = yield* selectSidecarMode(argv);
	switch (selected.mode) {
		case 'rpc':
			yield* Effect.sync(registerBunOAuthFlows);
			return yield* Layer.launch(SidecarLive);
		case 'axi': {
			const code = yield* runFlectCliMain(selected.argv, undefined, {
				bin: 'flect',
				clientName: 'flect'
			});
			process.exitCode = code;
			return;
		}
		case 'mcp':
			return yield* serveFlectMcp();
	}
});

BunRuntime.runMain(runSidecar(process.argv.slice(2)));
