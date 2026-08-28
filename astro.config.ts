import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';
import { flectIntegration } from './src/astro/flect-integration';
import { flectViteConfig } from './vite.config';

export default defineConfig({
	output: 'static',
	integrations: [preact({ compat: true }), flectIntegration()],
	outDir: './dist',
	// Pin the dev server to the port every other surface already assumes:
	// the Pi runtime's CORS allowlist (server/app.ts), the Playwright preview
	// webServer, and the README quickstart. Astro's own default (4321) would
	// silently diverge from all of them.
	server: {
		port: 5173
	},
	build: {
		assets: 'assets',
		inlineStylesheets: 'never'
	},
	vite: {
		...flectViteConfig,
		build: {
			...flectViteConfig.build,
			assetsInlineLimit: 0
		}
	}
});
