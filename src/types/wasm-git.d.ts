declare module 'wasm-git/lg2_opfs_async.js' {
	interface WasmGitFileSystem {
		readonly chdir: (path: string) => void;
		readonly mkdir: (path: string) => void;
		readonly readdir: (path: string) => ReadonlyArray<string>;
		readonly readFile: (
			path: string,
			options?: { readonly encoding?: 'utf8' }
		) => Uint8Array | string;
		readonly stat: (path: string) => { readonly mode: number };
		readonly isDir: (mode: number) => boolean;
		readonly isLink: (mode: number) => boolean;
		readonly readlink: (path: string) => string;
		readonly rmdir: (path: string) => void;
		readonly unlink: (path: string) => void;
		readonly writeFile: (path: string, contents: string | Uint8Array) => void;
	}

	export interface WasmGitModule {
		readonly FS: WasmGitFileSystem;
		readonly callMain: (args: ReadonlyArray<string>) => number | Promise<number>;
		readonly opfsExists: (path: string) => Promise<boolean>;
		readonly opfsLoadTree: (path: string) => Promise<boolean>;
		readonly opfsReadFile: (path: string, encoding?: 'utf8') => Promise<Uint8Array | string>;
		readonly opfsRemoveTree: (path: string) => Promise<void>;
		readonly opfsWriteFile: (path: string, contents: string | Uint8Array) => Promise<void>;
	}

	export default function initializeWasmGit(
		options?: Readonly<Record<string, unknown>>
	): Promise<WasmGitModule>;
}
