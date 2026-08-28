import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth';
import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { makeFlectHttpApp } from './app';
import { flectServerConfig } from './env.server';
import { FlectRuntimeWithPiLive } from './pi-services';
import { FlectTestRuntimeLive } from './test-runtime';

registerBunOAuthFlows();

const RuntimeLive = flectServerConfig.testMode ? FlectTestRuntimeLive : FlectRuntimeWithPiLive;

const ApplicationLive = makeFlectHttpApp().pipe(HttpRouter.provideRequest(RuntimeLive));

const ServerLive = HttpRouter.serve(ApplicationLive).pipe(
	Layer.provide(
		BunHttpServer.layer({
			hostname: '127.0.0.1',
			port: 3210,
			// Bun.serve's own default idleTimeout is 10s, measured server-side
			// per-connection inactivity, independent of anything Playwright or
			// the client waits on. Real, legitimately long-running requests
			// (e.g. shaping/agent turns and real-Git share operations under
			// tests/e2e/sharing.spec.ts, verified via server logs: "[Bun.serve]:
			// request timed out after 10 seconds") were getting the underlying
			// connection killed mid-flight, so the client never saw a response
			// (not an error - the socket just closed), leaving awaited UI state
			// stuck. This is a real product bug, not test-only: any client
			// (browser, desktop app) hitting a slow endpoint over a real
			// network hop is exposed to it. 255s is Bun's own maximum for this
			// option; still bounded, just past what any real request here
			// should ever take.
			idleTimeout: 255
		})
	)
);

Layer.launch(ServerLive).pipe(BunRuntime.runMain);
