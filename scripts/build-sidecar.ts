import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const binaries = [
	{
		name: 'private Flect runtime',
		entrypoint: resolve('server/sidecar.ts'),
		output: resolve('src-tauri/binaries/flect-runtime-aarch64-apple-darwin')
	}
] as const;

for (const binary of binaries) {
	await mkdir(dirname(binary.output), { recursive: true });
	const result = await Bun.build({
		entrypoints: [binary.entrypoint],
		target: 'bun',
		minify: false,
		sourcemap: 'none',
		compile: {
			target: 'bun-darwin-arm64',
			outfile: binary.output,
			autoloadDotenv: false,
			autoloadBunfig: false,
			autoloadTsconfig: false,
			autoloadPackageJson: false
		}
	});

	if (!result.success) {
		for (const message of result.logs) {
			console.error(message);
		}
		process.exitCode = 1;
		break;
	}
	console.log(`Built ${binary.name}: ${binary.output}`);
}
