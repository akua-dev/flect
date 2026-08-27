import type { Vfs } from '@riftydev/vfs';
import { Data } from 'effect';
import { type IFileSystem, InMemoryFs } from 'just-bash/browser';

const WORKSPACE_ROOT = '/workspace';
const FILE_LIMIT = 4_096;
const BYTE_LIMIT = 67_108_864;

/**
 * `IFileSystem`'s methods must stay Promise-returning to satisfy the
 * external `just-bash` shell contract, so failures still surface as thrown
 * errors rather than an Effect failure channel — but every throw site below
 * uses this one typed, discriminated error instead of ad hoc `new Error(...)`
 * calls, so callers that do want to branch on failure reason can.
 */
export class PersistentWorkspaceFsError extends Data.TaggedError('PersistentWorkspaceFsError')<{
	readonly reason:
		| 'invalid-namespace'
		| 'path-outside-workspace'
		| 'path-protected'
		| 'entry-limit-exceeded'
		| 'byte-limit-exceeded'
		| 'read-only'
		| 'restore-failed'
		| 'links-disabled';
	readonly message: string;
	readonly cause?: unknown;
}> {}

type ReadOptions = Parameters<IFileSystem['readFile']>[1];
type WriteContent = Parameters<IFileSystem['writeFile']>[1];
type WriteOptions = Parameters<IFileSystem['writeFile']>[2];
type MkdirOptions = Parameters<IFileSystem['mkdir']>[1];
type RmOptions = Parameters<IFileSystem['rm']>[1];
type CpOptions = Parameters<IFileSystem['cp']>[2];

type PersistentTreeEntry =
	| { readonly type: 'directory'; readonly path: string }
	| {
			readonly type: 'file';
			readonly path: string;
			readonly contents: Uint8Array;
	  };

export interface PersistentWorkspaceOptions {
	readonly vfs: Vfs;
	readonly namespace: string;
	readonly files: Readonly<Record<string, string | Uint8Array>>;
	readonly readOnly?: boolean;
}

export interface WorkspaceSourceFile {
	readonly path: string;
	readonly contents: Uint8Array;
}

const checkedNamespace = (namespace: string) => {
	if (!/^\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/.test(namespace)) {
		throw new PersistentWorkspaceFsError({
			reason: 'invalid-namespace',
			message: 'The persistent workspace namespace is invalid.'
		});
	}
	return namespace;
};

const workspaceRelative = (path: string) => {
	if (path === WORKSPACE_ROOT) {
		return '';
	}
	if (!path.startsWith(`${WORKSPACE_ROOT}/`)) {
		return undefined;
	}
	const relative = path.slice(WORKSPACE_ROOT.length + 1);
	const parts = relative.split('/');
	if (
		path.includes('\\') ||
		path.includes('\0') ||
		parts.some((part) => part.length === 0 || part === '.' || part === '..')
	) {
		throw new PersistentWorkspaceFsError({
			reason: 'path-outside-workspace',
			message: 'The requested path is outside the role workspace.'
		});
	}
	if (parts[0] === '.git' || parts[0] === '.flect-root') {
		throw new PersistentWorkspaceFsError({
			reason: 'path-protected',
			message: 'The requested path is protected by Flect.'
		});
	}
	return relative;
};

const parentPath = (path: string) => {
	const index = path.lastIndexOf('/');
	return index <= 0 ? '/' : path.slice(0, index);
};

const persistentPath = (namespace: string, relative: string) =>
	relative.length === 0 ? namespace : `${namespace}/${relative}`;

const walkVfs = async (
	vfs: Vfs,
	root: string,
	relative = '',
	output: Array<
		| { readonly type: 'directory'; readonly path: string }
		| {
				readonly type: 'file';
				readonly path: string;
				readonly contents: Uint8Array;
		  }
	> = []
) => {
	for (const entry of await vfs.readdir(persistentPath(root, relative))) {
		const path = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
		if (entry.isDirectory) {
			output.push({ type: 'directory', path });
			await walkVfs(vfs, root, path, output);
		} else if (entry.isFile) {
			output.push({
				type: 'file',
				path,
				contents: await vfs.readFile(persistentPath(root, path))
			});
		}
		if (output.length > FILE_LIMIT) {
			throw new PersistentWorkspaceFsError({
				reason: 'entry-limit-exceeded',
				message: 'The persistent role workspace contains too many entries.'
			});
		}
	}
	return output;
};

const ensurePersistentParent = (vfs: Vfs, path: string) =>
	vfs.mkdir(parentPath(path), { recursive: true });

const writePersistentTree = async (
	vfs: Vfs,
	namespace: string,
	entries: ReadonlyArray<PersistentTreeEntry>
) => {
	await vfs.mkdir(namespace, { recursive: true });
	for (const entry of entries) {
		const target = persistentPath(namespace, entry.path);
		if (entry.type === 'directory') {
			await vfs.mkdir(target, { recursive: true });
		} else {
			await ensurePersistentParent(vfs, target);
			await vfs.writeFile(target, entry.contents);
		}
	}
};

const snapshotWorkspaceTree = async (
	fs: IFileSystem
): Promise<ReadonlyArray<PersistentTreeEntry>> => {
	const entries: Array<PersistentTreeEntry> = [];
	let bytes = 0;
	for (const path of fs.getAllPaths().toSorted()) {
		if (path === '/workspace/.flect-root') {
			continue;
		}
		const relative = workspaceRelative(path);
		if (relative === undefined || relative.length === 0) {
			continue;
		}
		const stat = await fs.stat(path);
		if (stat.isDirectory) {
			entries.push({ type: 'directory', path: relative });
		} else if (stat.isFile) {
			const contents = await fs.readFileBuffer(path);
			bytes += contents.byteLength;
			entries.push({ type: 'file', path: relative, contents });
		}
		if (entries.length > FILE_LIMIT || bytes > BYTE_LIMIT) {
			throw new PersistentWorkspaceFsError({
				reason: 'byte-limit-exceeded',
				message: 'The role workspace exceeds its portable source limit.'
			});
		}
	}
	return entries;
};

export class PersistentWorkspaceFs implements IFileSystem {
	#memory: InMemoryFs;
	readonly #vfs: Vfs;
	readonly #namespace: string;
	readonly #readOnly: boolean;

	constructor(
		memory: InMemoryFs,
		options: {
			readonly vfs: Vfs;
			readonly namespace: string;
			readonly readOnly: boolean;
		}
	) {
		this.#memory = memory;
		this.#vfs = options.vfs;
		this.#namespace = options.namespace;
		this.#readOnly = options.readOnly;
	}

	#assertWritable(relative: string | undefined) {
		if (relative !== undefined && this.#readOnly) {
			throw new PersistentWorkspaceFsError({
				reason: 'read-only',
				message: 'This role workspace is read-only.'
			});
		}
	}

	async #restoreMemoryTree(entries: ReadonlyArray<PersistentTreeEntry>) {
		this.#memory = new InMemoryFs({ '/workspace/.flect-root': '' });
		for (const entry of entries) {
			const path = `${WORKSPACE_ROOT}/${entry.path}`;
			if (entry.type === 'directory') {
				await this.#memory.mkdir(path, { recursive: true });
			} else {
				await this.#memory.mkdir(parentPath(path), { recursive: true });
				await this.#memory.writeFile(path, entry.contents);
			}
		}
	}

	async #mutate<T>(mutation: () => Promise<T>) {
		const previousMemoryTree = await snapshotWorkspaceTree(this.#memory);
		let previousTree: ReadonlyArray<PersistentTreeEntry> | undefined;
		try {
			previousTree = await walkVfs(this.#vfs, this.#namespace);
			const result = await mutation();
			const nextTree = await snapshotWorkspaceTree(this.#memory);
			await this.#vfs.rm(this.#namespace, { recursive: true, force: true });
			await writePersistentTree(this.#vfs, this.#namespace, nextTree);
			return result;
		} catch (error) {
			try {
				if (previousTree !== undefined) {
					await this.#vfs.rm(this.#namespace, { recursive: true, force: true });
					await writePersistentTree(this.#vfs, this.#namespace, previousTree);
				}
				await this.#restoreMemoryTree(previousMemoryTree);
			} catch (rollbackError) {
				throw new PersistentWorkspaceFsError({
					reason: 'restore-failed',
					message:
						'The persistent role workspace could not be restored after a failed replacement.',
					cause: rollbackError
				});
			}
			throw error;
		}
	}

	readFile(path: string, options?: ReadOptions) {
		workspaceRelative(path);
		return this.#memory.readFile(path, options);
	}

	readFileBuffer(path: string) {
		workspaceRelative(path);
		return this.#memory.readFileBuffer(path);
	}

	async writeFile(path: string, content: WriteContent, options?: WriteOptions) {
		const relative = workspaceRelative(path);
		this.#assertWritable(relative);
		if (relative === undefined) {
			await this.#memory.writeFile(path, content, options);
			return;
		}
		await this.#mutate(() => this.#memory.writeFile(path, content, options));
	}

	async appendFile(path: string, content: WriteContent, options?: WriteOptions) {
		const relative = workspaceRelative(path);
		this.#assertWritable(relative);
		if (relative === undefined) {
			await this.#memory.appendFile(path, content, options);
			return;
		}
		await this.#mutate(() => this.#memory.appendFile(path, content, options));
	}

	exists(path: string) {
		workspaceRelative(path);
		return this.#memory.exists(path);
	}

	stat(path: string) {
		workspaceRelative(path);
		return this.#memory.stat(path);
	}

	lstat(path: string) {
		workspaceRelative(path);
		return this.#memory.lstat(path);
	}

	async mkdir(path: string, options?: MkdirOptions) {
		const relative = workspaceRelative(path);
		this.#assertWritable(relative);
		if (relative === undefined) {
			await this.#memory.mkdir(path, options);
			return;
		}
		await this.#mutate(() => this.#memory.mkdir(path, options));
	}

	readdir(path: string) {
		workspaceRelative(path);
		return this.#memory.readdir(path);
	}

	readdirWithFileTypes(path: string): Promise<
		Array<{
			name: string;
			isFile: boolean;
			isDirectory: boolean;
			isSymbolicLink: boolean;
		}>
	> {
		workspaceRelative(path);
		return this.#memory.readdirWithFileTypes(path);
	}

	async rm(path: string, options?: RmOptions) {
		const relative = workspaceRelative(path);
		this.#assertWritable(relative);
		if (relative === '') {
			throw new PersistentWorkspaceFsError({
				reason: 'path-protected',
				message: 'The role workspace root is protected by Flect.'
			});
		}
		if (relative === undefined) {
			await this.#memory.rm(path, options);
			return;
		}
		await this.#mutate(() => this.#memory.rm(path, options));
	}

	async cp(src: string, dest: string, options?: CpOptions) {
		const source = workspaceRelative(src);
		const destination = workspaceRelative(dest);
		this.#assertWritable(source);
		this.#assertWritable(destination);
		if (source !== undefined || destination !== undefined) {
			await this.#mutate(() => this.#memory.cp(src, dest, options));
			return;
		}
		await this.#memory.cp(src, dest, options);
	}

	async mv(src: string, dest: string) {
		const source = workspaceRelative(src);
		const destination = workspaceRelative(dest);
		this.#assertWritable(source);
		this.#assertWritable(destination);
		if (source !== undefined || destination !== undefined) {
			await this.#mutate(() => this.#memory.mv(src, dest));
			return;
		}
		await this.#memory.mv(src, dest);
	}

	resolvePath(base: string, path: string) {
		return this.#memory.resolvePath(base, path);
	}

	getAllPaths() {
		return this.#memory.getAllPaths();
	}

	chmod(path: string, mode: number) {
		const relative = workspaceRelative(path);
		this.#assertWritable(relative);
		return this.#memory.chmod(path, mode);
	}

	symlink(_target: string, linkPath: string): Promise<void> {
		workspaceRelative(linkPath);
		return Promise.reject(
			new PersistentWorkspaceFsError({
				reason: 'links-disabled',
				message: 'Filesystem links are disabled by Flect.'
			})
		);
	}

	link(_existingPath: string, newPath: string): Promise<void> {
		workspaceRelative(newPath);
		return Promise.reject(
			new PersistentWorkspaceFsError({
				reason: 'links-disabled',
				message: 'Filesystem links are disabled by Flect.'
			})
		);
	}

	readlink(path: string) {
		workspaceRelative(path);
		return this.#memory.readlink(path);
	}

	realpath(path: string) {
		workspaceRelative(path);
		return this.#memory.realpath(path);
	}

	async utimes(path: string, atime: Date, mtime: Date) {
		const relative = workspaceRelative(path);
		this.#assertWritable(relative);
		if (relative === undefined) {
			await this.#memory.utimes(path, atime, mtime);
			return;
		}
		await this.#mutate(() => this.#memory.utimes(path, atime, mtime));
	}
}

export const snapshotWorkspaceFiles = async (
	fs: IFileSystem
): Promise<ReadonlyArray<WorkspaceSourceFile>> => {
	const entries = await snapshotWorkspaceTree(fs);
	return entries.flatMap((entry) =>
		entry.type === 'file' ? [{ path: entry.path, contents: entry.contents }] : []
	);
};

export const makePersistentWorkspaceFs = async (options: PersistentWorkspaceOptions) => {
	const namespace = checkedNamespace(options.namespace);
	await options.vfs.mkdir(namespace, { recursive: true });
	const entries = await walkVfs(options.vfs, namespace);
	const memory = new InMemoryFs({ '/workspace/.flect-root': '' });
	if (entries.length === 0) {
		for (const [path, contents] of Object.entries(options.files)) {
			const relative = workspaceRelative(path);
			if (relative === undefined || relative.length === 0) {
				continue;
			}
			const target = persistentPath(namespace, relative);
			await ensurePersistentParent(options.vfs, target);
			await options.vfs.writeFile(target, contents);
			await memory.writeFile(path, contents);
		}
	} else {
		for (const entry of entries) {
			const path = `${WORKSPACE_ROOT}/${entry.path}`;
			if (entry.type === 'directory') {
				await memory.mkdir(path, { recursive: true });
			} else {
				await memory.writeFile(path, entry.contents);
			}
		}
	}
	return new PersistentWorkspaceFs(memory, {
		vfs: options.vfs,
		namespace,
		readOnly: options.readOnly ?? false
	});
};
