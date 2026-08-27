import { Context, Effect, FileSystem, Layer, Path, Result, Schema } from 'effect';
import {
	AgentIntegrationError,
	type AgentIntegrationHost as AgentIntegrationHostType,
	AgentIntegrationStatus
} from '../../shared/setup';

export {
	AgentIntegrationError,
	AgentIntegrationHost,
	AgentIntegrationState,
	AgentIntegrationStatus
} from '../../shared/setup';

export const FLECT_INTEGRATION_ID = 'dev.akua.flect-context';
const OWNED_STATUS_MESSAGE = `Loading Flect context · ${FLECT_INTEGRATION_ID}`;
const SESSION_MATCHER = 'startup|resume|clear|compact';
const GENERATED_DESCRIPTION = `Flect context integration · ${FLECT_INTEGRATION_ID}`;

export interface AgentIntegrationShape {
	readonly status: (
		host: AgentIntegrationHostType
	) => Effect.Effect<AgentIntegrationStatus, AgentIntegrationError>;
	readonly statusAll: Effect.Effect<ReadonlyArray<AgentIntegrationStatus>, AgentIntegrationError>;
	readonly install: (
		host: AgentIntegrationHostType
	) => Effect.Effect<AgentIntegrationStatus, AgentIntegrationError>;
	readonly remove: (
		host: AgentIntegrationHostType
	) => Effect.Effect<AgentIntegrationStatus, AgentIntegrationError>;
}

export class AgentIntegration extends Context.Service<AgentIntegration, AgentIntegrationShape>()(
	'flect/AgentIntegration'
) {}

type Json = typeof Schema.Json.Type;
type JsonObject = Readonly<Record<string, Json>>;

const JsonObject = Schema.Record(Schema.String, Schema.Json);
const JsonObjectFromString = Schema.fromJsonString(JsonObject);

const isObject = (value: Json | undefined): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const ownsHook = (value: Json): boolean =>
	isObject(value) && value.statusMessage === OWNED_STATUS_MESSAGE;

const expectedHandler = (host: 'codex' | 'claude'): JsonObject => ({
	type: 'command',
	command: `flect context --host ${host}`,
	statusMessage: OWNED_STATUS_MESSAGE,
	...(host === 'codex' ? { additionalContextLimit: 1200 } : {})
});

const integrationPath = (path: Path.Path, root: string, host: AgentIntegrationHostType) => {
	switch (host) {
		case 'codex':
			return path.join(root, '.codex', 'hooks.json');
		case 'claude':
			return path.join(root, '.claude', 'settings.local.json');
		case 'opencode':
			return path.join(root, '.opencode', 'plugins', 'flect.js');
	}
};

const integrationError = (
	host: AgentIntegrationHostType,
	reason: AgentIntegrationError['reason'],
	message: string
) => AgentIntegrationError.make({ host, reason, message });

const readJsonObject = Effect.fn('Flect.AgentIntegration.readJson')(function* (
	fs: FileSystem.FileSystem,
	host: 'codex' | 'claude',
	file: string
) {
	const source = yield* fs
		.readFileString(file)
		.pipe(Effect.mapError(() => integrationError(host, 'io', `Flect could not read ${file}.`)));
	return yield* Schema.decodeUnknownEffect(JsonObjectFromString)(source).pipe(
		Effect.mapError(() =>
			integrationError(host, 'invalid-config', `${file} is not a valid JSON object.`)
		)
	);
});

const sessionStart = (
	host: 'codex' | 'claude',
	root: JsonObject
): Effect.Effect<ReadonlyArray<Json>, AgentIntegrationError> => {
	const hooks = root.hooks;
	if (hooks === undefined) {
		return Effect.succeed([]);
	}
	if (!isObject(hooks)) {
		return Effect.fail(integrationError(host, 'invalid-config', 'hooks must be a JSON object.'));
	}
	const value = hooks.SessionStart;
	if (value === undefined) {
		return Effect.succeed([]);
	}
	return Array.isArray(value)
		? Effect.succeed(value)
		: Effect.fail(integrationError(host, 'invalid-config', 'hooks.SessionStart must be an array.'));
};

const handlerList = (
	host: 'codex' | 'claude',
	group: Json
): Effect.Effect<ReadonlyArray<Json>, AgentIntegrationError> => {
	if (!isObject(group) || !Array.isArray(group.hooks)) {
		return Effect.fail(
			integrationError(
				host,
				'invalid-config',
				'Each SessionStart group must contain a hooks array.'
			)
		);
	}
	return Effect.succeed(group.hooks);
};

const ownedHookCount = Effect.fn('Flect.AgentIntegration.ownedHookCount')(function* (
	host: 'codex' | 'claude',
	root: JsonObject
) {
	const groups = yield* sessionStart(host, root);
	let owned = 0;
	let exact = 0;
	const expected = JSON.stringify(expectedHandler(host));
	for (const group of groups) {
		const handlers = yield* handlerList(host, group);
		if (!isObject(group)) {
			continue;
		}
		for (const handler of handlers) {
			if (ownsHook(handler)) {
				owned += 1;
				if (group.matcher === SESSION_MATCHER && JSON.stringify(handler) === expected) {
					exact += 1;
				}
			}
		}
	}
	return { owned, exact };
});

const withoutOwnedHooks = Effect.fn('Flect.AgentIntegration.withoutOwnedHooks')(function* (
	host: 'codex' | 'claude',
	root: JsonObject
) {
	const groups = yield* sessionStart(host, root);
	const filteredGroups: Array<Json> = [];
	for (const group of groups) {
		const handlers = yield* handlerList(host, group);
		const filtered = handlers.filter((handler) => !ownsHook(handler));
		if (filtered.length > 0 && isObject(group)) {
			filteredGroups.push({ ...group, hooks: filtered });
		}
	}

	const currentHooks = root.hooks;
	const hooks: Record<string, Json> = isObject(currentHooks) ? { ...currentHooks } : {};
	if (filteredGroups.length === 0) {
		delete hooks.SessionStart;
	} else {
		hooks.SessionStart = filteredGroups;
	}
	return { ...root, hooks } satisfies JsonObject;
});

const addOwnedHook = Effect.fn('Flect.AgentIntegration.addOwnedHook')(function* (
	host: 'codex' | 'claude',
	root: JsonObject
) {
	const clean = yield* withoutOwnedHooks(host, root);
	const hooks: Record<string, Json> = isObject(clean.hooks) ? { ...clean.hooks } : {};
	const groups = Array.isArray(hooks.SessionStart) ? [...hooks.SessionStart] : [];
	const matchingIndex = groups.findIndex(
		(group) => isObject(group) && group.matcher === SESSION_MATCHER
	);
	if (matchingIndex >= 0) {
		const matching = groups[matchingIndex];
		if (matching !== undefined && isObject(matching)) {
			const handlers = yield* handlerList(host, matching);
			groups[matchingIndex] = {
				...matching,
				hooks: [...handlers, expectedHandler(host)]
			};
		}
	} else {
		groups.push({
			matcher: SESSION_MATCHER,
			hooks: [expectedHandler(host)]
		});
	}
	hooks.SessionStart = groups;
	return {
		...clean,
		...(Object.keys(root).length === 0 ? { description: GENERATED_DESCRIPTION } : {}),
		hooks
	} satisfies JsonObject;
});

const isGeneratedEmptyConfig = (root: JsonObject) => {
	if (root.description !== GENERATED_DESCRIPTION || !isObject(root.hooks)) {
		return false;
	}
	return (
		Object.keys(root).every((key) => key === 'description' || key === 'hooks') &&
		Object.keys(root.hooks).length === 0
	);
};

export const OPENCODE_PLUGIN_SOURCE = `// ${FLECT_INTEGRATION_ID}
const MAX_CONTEXT_BYTES = 1200;

const boundedContext = async () => {
  const process = Bun.spawn(["flect", "context", "--host", "opencode"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = process.stdout.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  while (size < MAX_CONTEXT_BYTES) {
    const next = await reader.read();
    if (next.done) break;
    const remaining = MAX_CONTEXT_BYTES - size;
    const chunk = next.value.subarray(0, remaining);
    chunks.push(chunk);
    size += chunk.byteLength;
    if (chunk.byteLength < next.value.byteLength) {
      truncated = true;
      process.kill();
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const exitCode = await process.exited;
  if (exitCode !== 0 && !truncated) return "";
  const text = new TextDecoder().decode(bytes).trim();
  return truncated ? \`${'$'}{text}\\n[bounded by Flect]\` : text;
};

const eventValue = (envelope) => envelope?.event ?? envelope;
const eventSession = (event) =>
  event?.sessionID ?? event?.properties?.sessionID ?? event?.data?.sessionID;

export default {
  id: "${FLECT_INTEGRATION_ID}",
  setup: async (ctx) => {
    const injected = new Set();
    const controller = new AbortController();
    const eventTask = (async () => {
      try {
        const subscription = await ctx.event.subscribe({
          signal: controller.signal,
        });
        const stream = subscription?.stream ?? subscription;
        for await (const envelope of stream) {
          const event = eventValue(envelope);
          if (event?.type === "session.compacted") {
            const sessionID = eventSession(event);
            if (typeof sessionID === "string") injected.delete(sessionID);
          }
        }
      } catch {
        // OpenCode stops or reloads the plugin by aborting the subscription.
      }
    })();

    await ctx.session.hook("request", async (event) => {
      const sessionID = eventSession(event) ?? "default";
      if (injected.has(sessionID)) return;
      injected.add(sessionID);
      const context = await boundedContext();
      if (context.length === 0) {
        injected.delete(sessionID);
        return;
      }
      event.system.push({ type: "text", text: context });
    });

    return async () => {
      controller.abort();
      await eventTask;
    };
  },
};
`;

const formatJson = (value: JsonObject) => `${JSON.stringify(value, null, 2)}\n`;

export const makeAgentIntegrationLayer = (root: string) =>
	Layer.effect(
		AgentIntegration,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;

			const writePrivate = Effect.fn('Flect.AgentIntegration.writePrivate')(function* (
				host: AgentIntegrationHostType,
				file: string,
				content: string
			) {
				const parent = path.dirname(file);
				const temporary = path.join(
					parent,
					`.flect-${FLECT_INTEGRATION_ID}-${crypto.randomUUID()}.tmp`
				);
				const cleanup = fs.remove(temporary, { force: true }).pipe(Effect.catch(() => Effect.void));
				yield* fs.makeDirectory(parent, { recursive: true, mode: 0o700 }).pipe(
					Effect.andThen(fs.writeFileString(temporary, content, { mode: 0o600 })),
					Effect.andThen(fs.chmod(temporary, 0o600)),
					Effect.andThen(fs.rename(temporary, file)),
					Effect.andThen(fs.chmod(file, 0o600)),
					Effect.ensuring(cleanup),
					Effect.mapError(() => integrationError(host, 'io', `Flect could not write ${file}.`))
				);
			});

			const status = Effect.fn('Flect.AgentIntegration.status')(function* (
				host: AgentIntegrationHostType
			) {
				const file = integrationPath(path, root, host);
				const exists = yield* fs
					.exists(file)
					.pipe(
						Effect.mapError(() => integrationError(host, 'io', `Flect could not inspect ${file}.`))
					);
				if (!exists) {
					return AgentIntegrationStatus.make({
						host,
						state: 'absent',
						path: file,
						changed: false
					});
				}
				if (host === 'opencode') {
					const source = yield* fs
						.readFileString(file)
						.pipe(
							Effect.mapError(() => integrationError(host, 'io', `Flect could not read ${file}.`))
						);
					return AgentIntegrationStatus.make({
						host,
						state:
							source === OPENCODE_PLUGIN_SOURCE
								? 'installed'
								: source.includes(FLECT_INTEGRATION_ID)
									? 'stale'
									: 'conflict',
						path: file,
						changed: false
					});
				}
				const decoded = yield* Effect.result(readJsonObject(fs, host, file));
				if (Result.isFailure(decoded)) {
					return AgentIntegrationStatus.make({
						host,
						state: 'conflict',
						path: file,
						changed: false
					});
				}
				const count = yield* ownedHookCount(host, decoded.success).pipe(Effect.result);
				return AgentIntegrationStatus.make({
					host,
					state: Result.isFailure(count)
						? 'conflict'
						: count.success.owned === 0
							? 'absent'
							: count.success.owned === 1 && count.success.exact === 1
								? 'installed'
								: 'stale',
					path: file,
					changed: false
				});
			});

			const install = Effect.fn('Flect.AgentIntegration.install')(function* (
				host: AgentIntegrationHostType
			) {
				const before = yield* status(host);
				if (before.state === 'installed') {
					return before;
				}
				if (before.state === 'conflict') {
					return yield* Effect.fail(
						integrationError(
							host,
							'conflict',
							`${before.path} is owned by incompatible user configuration.`
						)
					);
				}
				if (host === 'opencode') {
					yield* writePrivate(host, before.path, OPENCODE_PLUGIN_SOURCE);
				} else {
					const exists = yield* fs
						.exists(before.path)
						.pipe(
							Effect.mapError(() =>
								integrationError(host, 'io', `Flect could not inspect ${before.path}.`)
							)
						);
					const rootObject =
						before.state === 'absent' && !exists
							? {}
							: yield* readJsonObject(fs, host, before.path);
					const merged = yield* addOwnedHook(host, rootObject);
					yield* writePrivate(host, before.path, formatJson(merged));
				}
				return AgentIntegrationStatus.make({
					host,
					state: 'installed',
					path: before.path,
					changed: true
				});
			});

			const remove = Effect.fn('Flect.AgentIntegration.remove')(function* (
				host: AgentIntegrationHostType
			) {
				const before = yield* status(host);
				if (before.state === 'absent') {
					return before;
				}
				if (before.state === 'conflict') {
					return yield* Effect.fail(
						integrationError(
							host,
							'conflict',
							`${before.path} does not carry Flect's integration ownership marker.`
						)
					);
				}
				if (host === 'opencode') {
					yield* fs
						.remove(before.path)
						.pipe(
							Effect.mapError(() =>
								integrationError(host, 'io', `Flect could not remove ${before.path}.`)
							)
						);
				} else {
					const rootObject = yield* readJsonObject(fs, host, before.path);
					const clean = yield* withoutOwnedHooks(host, rootObject);
					if (isGeneratedEmptyConfig(clean)) {
						yield* fs
							.remove(before.path)
							.pipe(
								Effect.mapError(() =>
									integrationError(host, 'io', `Flect could not remove ${before.path}.`)
								)
							);
					} else {
						yield* writePrivate(host, before.path, formatJson(clean));
					}
				}
				return AgentIntegrationStatus.make({
					host,
					state: 'absent',
					path: before.path,
					changed: true
				});
			});

			return {
				status,
				statusAll: Effect.all([status('codex'), status('claude'), status('opencode')]),
				install,
				remove
			} satisfies AgentIntegrationShape;
		})
	);
