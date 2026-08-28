import { Effect, Schema } from 'effect';
import {
	ProductCapabilityDecisionId,
	type ProductJson,
	ProductOperationId
} from '../../packages/product/src/product-capability';
import { ShareGitSource, ShareUrlSource } from '../../packages/product/src/share';
import { ModelSelection } from '../../shared/contracts';
import {
	AcceptProposal,
	CancelRole,
	DisableControl,
	EnterSafeMode,
	ExportShare,
	type FlectCommand,
	OpenShareSource,
	RejectProposal,
	RejectShareCandidate,
	RestoreSafeMode,
	SelectModel,
	SelectWorkbenchTarget,
	SetExternalExtensions,
	SetMode,
	SetModelFavorite,
	SetRailCollapsed,
	SetRailWidth
} from '../../shared/control';
import type { AxiAudience, AxiFormat } from './contracts';

export interface FlectCommandMetadata {
	readonly usage: string;
	readonly summary: string;
	readonly audiences: ReadonlyArray<AxiAudience>;
}

const everyAudience = ['native', 'app', 'shaper'] as const;
const nativeOnly = ['native'] as const;

export const FLECT_COMMAND_METADATA: ReadonlyArray<FlectCommandMetadata> = [
	{
		usage: 'flect',
		summary: 'Show content-first live discovery and relevant next commands.',
		audiences: everyAudience
	},
	{
		usage: 'flect inspect [--fields <closed-list>]',
		summary: 'Inspect validated live workspace state.',
		audiences: everyAudience
	},
	{
		usage: 'flect logs [--limit <n>] [--role <app|shaper>]',
		summary: 'Read bounded, correlated operation evidence.',
		audiences: everyAudience
	},
	{
		usage: 'flect watch [--after <sequence>]',
		summary: 'Wait for the next reactive workspace event.',
		audiences: everyAudience
	},
	{
		usage: 'flect target <use|shape>',
		summary: 'Select the visible Use or Shape conversation explicitly.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect mode set <edit|run>',
		summary: 'Compatibility alias for selecting Shape or Use.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect prompt <text>|--stdin',
		summary: 'Ask App Agent to use the accepted product.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect shape <instruction>|--stdin',
		summary: 'Ask Shaper to prepare a validated interface proposal.',
		audiences: ['native', 'shaper']
	},
	{
		usage: 'flect cancel <app|shaper>',
		summary: 'Stop the selected running agent turn.',
		audiences: nativeOnly
	},
	{
		usage: 'flect action list|inspect|invoke',
		summary: 'Discover and invoke actions projected by the visible interface.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect product invoke <operation-id> [--input <json>]',
		summary: 'Invoke a registered product operation without raw HTTP access.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect permissions list|revoke <decision-id>',
		summary:
			'Inspect product permission lifecycle or revoke a visible decision; grants remain protected UI decisions.',
		audiences: everyAudience
	},
	{
		usage: 'flect interface inspect|schema|validate|propose',
		summary: "Inspect or propose interface documents inside Shaper's sandbox.",
		audiences: ['shaper']
	},
	{
		usage: 'flect app validate|propose <sandbox-dir> [--name <text>]',
		summary:
			"Package authored web app source from Shaper's sandbox and propose it as the running canvas.",
		audiences: ['shaper']
	},
	{
		usage: 'flect proposal accept|reject',
		summary: 'Resolve the current validated preview as a protected user decision.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect revision list|rollback',
		summary: 'Inspect revision state or request deterministic rollback.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect repository status',
		summary: 'Inspect canonical Git refs, isolation, and conflict state.',
		audiences: everyAudience
	},
	{
		usage: 'flect share list|inspect',
		summary: 'Inspect bounded inactive shared candidates and retained installations.',
		audiences: everyAudience
	},
	{
		usage: 'flect share open-url|open-git|reject|export',
		summary: 'Route bounded shared-source actions through protected user review.',
		audiences: nativeOnly
	},
	{
		usage:
			'flect share checkpoint <share-id> --at <commit> --write <share-path> <sandbox-path> --message <text>',
		summary: 'Checkpoint bounded Shaper sandbox files onto an exact retained share fork.',
		audiences: ['shaper']
	},
	{
		usage:
			'flect share resolve <share-id> --base <commit> --upstream <commit> --fork <commit> --write <share-path> <sandbox-path> --message <text>',
		summary: 'Submit an exact bounded Shaper resolution for every reviewed shared conflict path.',
		audiences: ['shaper']
	},
	{
		usage: 'flect model list|select|favorite',
		summary: 'Inspect and select Pi-backed models without exposing credentials.',
		audiences: ['native', 'app', 'shaper']
	},
	{
		usage: 'flect extensions list|describe|call',
		summary: 'Discover and call enabled portable extensions for the current role and binding.',
		audiences: everyAudience
	},
	{
		usage: 'flect trusted-extensions enable|disable <app|shaper>',
		summary: "Set opt-in loading for the selected Pi role's outside extensions.",
		audiences: ['native', 'app']
	},
	{
		usage: 'flect safe enter|restore',
		summary: 'Enter compiled recovery or restore the last-known-good interface.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect rail collapse|expand|width <pixels>',
		summary: 'Set the protected agent rail presentation.',
		audiences: ['native', 'app']
	},
	{
		usage: 'flect control status|disable',
		summary: 'Inspect or revoke explicitly granted outside control.',
		audiences: nativeOnly
	},
	{
		usage: 'flect context --host <codex|claude|opencode>',
		summary: 'Emit bounded static guidance plus available live Flect context.',
		audiences: nativeOnly
	},
	{
		usage: 'flect setup status',
		summary: 'Inspect the fixed shell link and opt-in agent integrations.',
		audiences: nativeOnly
	},
	{
		usage: 'flect setup shell install|remove',
		summary: 'Manage only ~/.local/bin/flect for the installed desktop app.',
		audiences: nativeOnly
	},
	{
		usage: 'flect setup agent install|remove <codex|claude|opencode>',
		summary: 'Manage one ownership-marked ambient context integration.',
		audiences: nativeOnly
	},
	{
		usage: 'flect setup uninstall inspect|prepare',
		summary: 'Inspect or remove only Flect-owned integrations before moving the app to Trash.',
		audiences: nativeOnly
	},
	{
		usage: 'flect mcp',
		summary: 'Serve the compact MCP adapter over stdio.',
		audiences: nativeOnly
	}
];

export class AxiUsageError extends Schema.TaggedErrorClass<AxiUsageError>()('AxiUsageError', {
	code: Schema.Literals([
		'unknown-flag',
		'unknown-command',
		'missing-argument',
		'invalid-argument',
		'unexpected-argument'
	]),
	message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
	help: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500))).check(
		Schema.isMaxLength(4)
	)
}) {}

export type AxiReadCommand =
	| { readonly kind: 'home' }
	| { readonly kind: 'app' }
	| { readonly kind: 'status' }
	| { readonly kind: 'inspect'; readonly fields: ReadonlyArray<string> }
	| {
			readonly kind: 'logs';
			readonly limit: number;
			readonly role?: 'app' | 'shaper';
			readonly operationId?: string;
	  }
	| { readonly kind: 'watch'; readonly after: number }
	| { readonly kind: 'action-list' }
	| { readonly kind: 'action-inspect'; readonly nodeId: string }
	| { readonly kind: 'action-invoke'; readonly nodeId: string }
	| {
			readonly kind: 'product-invoke';
			readonly operationId: string;
			readonly input: ProductJson;
	  }
	| { readonly kind: 'permissions-list' }
	| { readonly kind: 'permissions-revoke'; readonly decisionId: string }
	| { readonly kind: 'portable-extension-list' }
	| {
			readonly kind: 'portable-extension-describe';
			readonly extensionId: string;
	  }
	| {
			readonly kind: 'portable-extension-call';
			readonly extensionId: string;
			readonly input: ProductJson;
	  }
	| { readonly kind: 'interface-inspect' }
	| { readonly kind: 'interface-schema' }
	| { readonly kind: 'interface-validate'; readonly path: string }
	| { readonly kind: 'interface-propose'; readonly path: string }
	| {
			readonly kind: 'app-validate';
			readonly path: string;
			readonly name?: string;
	  }
	| {
			readonly kind: 'app-propose';
			readonly path: string;
			readonly name?: string;
	  }
	| { readonly kind: 'revision-list' }
	| { readonly kind: 'revision-rollback'; readonly revisionId?: string }
	| { readonly kind: 'repository-status' }
	| { readonly kind: 'share-list' }
	| { readonly kind: 'share-inspect'; readonly shareId?: string }
	| { readonly kind: 'model-list' }
	| { readonly kind: 'control-status' }
	| {
			readonly kind: 'context';
			readonly host: 'codex' | 'claude' | 'opencode';
	  }
	| { readonly kind: 'setup-status' }
	| {
			readonly kind: 'setup-shell';
			readonly action: 'install' | 'remove';
	  }
	| {
			readonly kind: 'setup-agent';
			readonly action: 'install' | 'remove';
			readonly agent: 'codex' | 'claude' | 'opencode';
	  }
	| {
			readonly kind: 'setup-uninstall';
			readonly action: 'inspect' | 'prepare';
	  }
	| { readonly kind: 'mcp' }
	| { readonly kind: 'help'; readonly path: ReadonlyArray<string> }
	| {
			readonly kind: 'prompt';
			readonly role: 'app' | 'shaper';
			readonly fromStdin: boolean;
			readonly text: string;
	  }
	| { readonly kind: 'command'; readonly command: FlectCommand };

export interface ParsedAxiArguments {
	readonly audience: AxiAudience;
	readonly format: AxiFormat;
	readonly full: boolean;
	readonly command: AxiReadCommand;
}

type UsageCode = AxiUsageError['code'];

const usage = (code: UsageCode, message: string, help: ReadonlyArray<string> = []) =>
	AxiUsageError.make({ code, message, help: [...help] });

const failed = (code: UsageCode, message: string, help?: ReadonlyArray<string>) =>
	Effect.fail(usage(code, message, help));

const unknownFlag = (flag: string) =>
	failed('unknown-flag', `Unknown flag: ${flag}`, ['Run `flect --help` for the command reference']);

const requireNoExtra = (values: ReadonlyArray<string>) => {
	const extra = values[0];
	return extra === undefined
		? Effect.void
		: extra.startsWith('-')
			? unknownFlag(extra)
			: failed('unexpected-argument', `Unexpected argument: ${extra}`);
};

const modelSelection = (input: string) => {
	const separator = input.indexOf('/');
	return separator <= 0 || separator === input.length - 1
		? undefined
		: ModelSelection.make({
				provider: input.slice(0, separator),
				id: input.slice(separator + 1)
			});
};

const positiveInteger = (value: string | undefined, label: string, minimum = 0) => {
	const parsed = value === undefined ? Number.NaN : Number(value);
	return Number.isInteger(parsed) && parsed >= minimum
		? Effect.succeed(parsed)
		: failed('invalid-argument', `${label} must be an integer of at least ${minimum}.`);
};

const ShareId = Schema.String.check(
	Schema.isMinLength(3),
	Schema.isMaxLength(120),
	Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/)
);

const shareId = (value: string) =>
	Schema.decodeUnknownEffect(ShareId)(value).pipe(
		Effect.mapError(() => usage('invalid-argument', 'Share ID is invalid.'))
	);

const leafHelp = (args: ReadonlyArray<string>) =>
	args.at(-1) === '--help' ? args.slice(0, -1) : undefined;

const parseLogs = Effect.fn('Flect.Axi.parseLogs')(function* (args: ReadonlyArray<string>) {
	let limit = 20;
	let role: 'app' | 'shaper' | undefined;
	let operationId: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		const value = args[index + 1];
		switch (flag) {
			case '--limit':
				limit = yield* positiveInteger(value, 'Log limit', 1);
				if (limit > 500) {
					return yield* failed('invalid-argument', 'Log limit cannot exceed 500.');
				}
				index += 1;
				break;
			case '--role':
				if (value !== 'app' && value !== 'shaper') {
					return yield* failed('invalid-argument', 'Log role must be app or shaper.');
				}
				role = value;
				index += 1;
				break;
			case '--operation':
				if (value === undefined || value.startsWith('-')) {
					return yield* failed('missing-argument', '--operation requires an identifier.');
				}
				operationId = value;
				index += 1;
				break;
			case undefined:
				return yield* failed('unexpected-argument', 'Unexpected argument: ');
			default:
				return yield* flag.startsWith('-')
					? unknownFlag(flag)
					: failed('unexpected-argument', `Unexpected argument: ${flag}`);
		}
	}
	return {
		kind: 'logs',
		limit,
		...(role === undefined ? {} : { role }),
		...(operationId === undefined ? {} : { operationId })
	} as const;
});

const parseCommand = Effect.fn('Flect.Axi.parseCommand')(function* (
	args: ReadonlyArray<string>
): Effect.fn.Return<AxiReadCommand, AxiUsageError> {
	const helpPath = leafHelp(args);
	if (helpPath !== undefined) {
		return { kind: 'help', path: helpPath };
	}
	const [noun, verb, value, ...rest] = args;
	if (noun === undefined) {
		return { kind: 'home' };
	}
	if (noun.startsWith('-')) {
		return yield* unknownFlag(noun);
	}
	switch (noun) {
		case 'app': {
			if (verb === undefined) {
				return { kind: 'app' };
			}
			if (verb === 'validate' || verb === 'propose') {
				if (value === undefined || value.startsWith('-')) {
					return yield* failed('missing-argument', `app ${verb} requires a sandbox directory.`);
				}
				let name: string | undefined;
				if (rest.length > 0) {
					if (rest[0] !== '--name' || rest[1] === undefined) {
						return yield* rest[0]?.startsWith('-') === true && rest[0] !== '--name'
							? unknownFlag(rest[0] ?? '')
							: failed(
									'invalid-argument',
									`Usage: flect app ${verb} <sandbox-dir> [--name <text>].`
								);
					}
					name = rest[1];
					yield* requireNoExtra(rest.slice(2));
				}
				return {
					kind: verb === 'validate' ? 'app-validate' : 'app-propose',
					path: value,
					...(name === undefined ? {} : { name })
				};
			}
			return yield* failed('unknown-command', `Unknown app command: ${verb}`);
		}
		case 'status':
		case 'mcp':
			yield* requireNoExtra(args.slice(1));
			return { kind: noun };
		case 'inspect': {
			if (verb === undefined) {
				return { kind: 'inspect', fields: [] };
			}
			if (verb !== '--fields') {
				return yield* verb.startsWith('-')
					? unknownFlag(verb)
					: failed('unexpected-argument', `Unexpected argument: ${verb}`);
			}
			if (value === undefined) {
				return yield* failed('missing-argument', '--fields requires a comma-separated field list.');
			}
			yield* requireNoExtra(rest);
			const fields = value.split(',').filter((field) => field.length > 0);
			const allowed = new Set([
				'workspace',
				'mode',
				'phase',
				'sequence',
				'agents',
				'proposal',
				'workbench',
				'control',
				'repository',
				'document',
				'extensions',
				'shares',
				'share-review'
			]);
			const invented = fields.find((field) => !allowed.has(field));
			if (invented !== undefined) {
				return yield* failed('invalid-argument', `Unknown inspect field: ${invented}`);
			}
			return { kind: 'inspect', fields };
		}
		case 'logs':
			return yield* parseLogs(args.slice(1));
		case 'watch': {
			if (verb === undefined) {
				return { kind: 'watch', after: 0 };
			}
			if (verb !== '--after') {
				return yield* verb.startsWith('-')
					? unknownFlag(verb)
					: failed('unexpected-argument', `Unexpected argument: ${verb}`);
			}
			const after = yield* positiveInteger(value, 'Event sequence');
			yield* requireNoExtra(rest);
			return { kind: 'watch', after };
		}
		case 'mode':
			if (verb !== 'set' || (value !== 'edit' && value !== 'run')) {
				return yield* failed('invalid-argument', 'Usage: flect mode set <edit|run>.');
			}
			yield* requireNoExtra(rest);
			return {
				kind: 'command',
				command: SetMode.make({ type: 'set-mode', mode: value })
			};
		case 'target':
			if (verb !== 'use' && verb !== 'shape') {
				return yield* failed('invalid-argument', 'Usage: flect target <use|shape>.');
			}
			yield* requireNoExtra(args.slice(2));
			return {
				kind: 'command',
				command: SelectWorkbenchTarget.make({
					type: 'select-workbench-target',
					target: verb
				})
			};
		case 'prompt':
		case 'shape': {
			const values = args.slice(1);
			const fromStdin = values[0] === '--stdin';
			if (fromStdin) {
				yield* requireNoExtra(values.slice(1));
				return {
					kind: 'prompt',
					role: noun === 'prompt' ? 'app' : 'shaper',
					fromStdin: true,
					text: ''
				};
			}
			const text = values.join(' ').trim();
			if (text.length === 0) {
				return yield* failed('missing-argument', `${noun} requires text or --stdin.`);
			}
			return {
				kind: 'prompt',
				role: noun === 'prompt' ? 'app' : 'shaper',
				fromStdin: false,
				text
			};
		}
		case 'cancel':
			if (verb !== 'app' && verb !== 'shaper') {
				return yield* failed('invalid-argument', 'Usage: flect cancel <app|shaper>.');
			}
			yield* requireNoExtra(args.slice(2));
			return {
				kind: 'command',
				command: CancelRole.make({ type: 'cancel-role', role: verb })
			};
		case 'action':
			if (verb === 'list') {
				yield* requireNoExtra(args.slice(2));
				return { kind: 'action-list' };
			}
			if (verb === 'inspect' || verb === 'invoke') {
				if (value === undefined) {
					return yield* failed('missing-argument', `action ${verb} requires a node identifier.`);
				}
				yield* requireNoExtra(rest);
				return verb === 'inspect'
					? { kind: 'action-inspect', nodeId: value }
					: { kind: 'action-invoke', nodeId: value };
			}
			return yield* failed('unknown-command', `Unknown action command: ${verb ?? ''}`);
		case 'product': {
			if (verb !== 'invoke' || value === undefined) {
				return yield* failed(
					'invalid-argument',
					'Usage: flect product invoke <operation-id> [--input <json>].'
				);
			}
			const operationId = yield* Schema.decodeUnknownEffect(ProductOperationId)(value).pipe(
				Effect.mapError(() => usage('invalid-argument', 'Product operation ID is invalid.'))
			);
			if (rest.length === 0) {
				return { kind: 'product-invoke', operationId, input: null };
			}
			if (rest[0] !== '--input' || rest[1] === undefined) {
				return yield* failed(
					rest[0]?.startsWith('-') === true ? 'unknown-flag' : 'invalid-argument',
					'Usage: flect product invoke <operation-id> [--input <json>].'
				);
			}
			yield* requireNoExtra(rest.slice(2));
			const input = yield* Effect.try({
				try: () => JSON.parse(rest[1] ?? ''),
				catch: () => usage('invalid-argument', 'Product input must be valid JSON.')
			}).pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
				Effect.mapError(() => usage('invalid-argument', 'Product input must be valid JSON.'))
			);
			return { kind: 'product-invoke', operationId, input };
		}
		case 'permissions': {
			if (verb === 'list') {
				yield* requireNoExtra(args.slice(2));
				return { kind: 'permissions-list' };
			}
			if (verb !== 'revoke' || value === undefined) {
				return yield* failed(
					'invalid-argument',
					'Usage: flect permissions list|revoke <decision-id>.'
				);
			}
			yield* requireNoExtra(rest);
			const decisionId = yield* Schema.decodeUnknownEffect(ProductCapabilityDecisionId)(value).pipe(
				Effect.mapError(() => usage('invalid-argument', 'Permission decision ID is invalid.'))
			);
			return { kind: 'permissions-revoke', decisionId };
		}
		case 'interface':
			if (verb === 'inspect' || verb === 'schema') {
				yield* requireNoExtra(args.slice(2));
				return {
					kind: verb === 'inspect' ? 'interface-inspect' : 'interface-schema'
				};
			}
			if (verb === 'validate' || verb === 'propose') {
				if (value === undefined) {
					return yield* failed('missing-argument', `interface ${verb} requires a sandbox path.`);
				}
				yield* requireNoExtra(rest);
				return {
					kind: verb === 'validate' ? 'interface-validate' : 'interface-propose',
					path: value
				};
			}
			return yield* failed('unknown-command', `Unknown interface command: ${verb ?? ''}`);
		case 'proposal':
			yield* requireNoExtra(args.slice(2));
			if (verb !== 'accept' && verb !== 'reject') {
				return yield* failed('unknown-command', `Unknown proposal command: ${verb ?? ''}`);
			}
			return {
				kind: 'command',
				command:
					verb === 'accept'
						? AcceptProposal.make({ type: 'accept-proposal' })
						: RejectProposal.make({ type: 'reject-proposal' })
			};
		case 'revision':
			if (verb === 'list') {
				yield* requireNoExtra(args.slice(2));
				return { kind: 'revision-list' };
			}
			if (verb === 'rollback') {
				yield* requireNoExtra(rest);
				return {
					kind: 'revision-rollback',
					...(value === undefined ? {} : { revisionId: value })
				};
			}
			return yield* failed('unknown-command', `Unknown revision command: ${verb ?? ''}`);
		case 'repository':
			yield* requireNoExtra(args.slice(2));
			return verb === 'status'
				? { kind: 'repository-status' }
				: yield* failed('unknown-command', `Unknown repository command: ${verb ?? ''}`);
		case 'share': {
			if (verb === 'list') {
				yield* requireNoExtra(args.slice(2));
				return { kind: 'share-list' };
			}
			if (verb === 'inspect') {
				yield* requireNoExtra(args.slice(value === undefined ? 2 : 3));
				return value === undefined
					? { kind: 'share-inspect' }
					: { kind: 'share-inspect', shareId: yield* shareId(value) };
			}
			if (verb === 'open-url') {
				if (value === undefined) {
					return yield* failed('missing-argument', 'share open-url requires an HTTPS URL.');
				}
				yield* requireNoExtra(rest);
				const source = yield* Schema.decodeUnknownEffect(ShareUrlSource)({
					_tag: 'url',
					url: value
				}).pipe(Effect.mapError(() => usage('invalid-argument', 'Share URL is invalid.')));
				return {
					kind: 'command',
					command: OpenShareSource.make({ type: 'open-share-source', source })
				};
			}
			if (verb === 'open-git') {
				const commit = rest[0];
				if (value === undefined || commit === undefined) {
					return yield* failed(
						'missing-argument',
						'share open-git requires an HTTPS URL and exact commit.'
					);
				}
				yield* requireNoExtra(rest.slice(1));
				const source = yield* Schema.decodeUnknownEffect(ShareGitSource)({
					_tag: 'git',
					url: value,
					commit
				}).pipe(Effect.mapError(() => usage('invalid-argument', 'Share Git source is invalid.')));
				return {
					kind: 'command',
					command: OpenShareSource.make({ type: 'open-share-source', source })
				};
			}
			if (verb === 'reject') {
				yield* requireNoExtra(args.slice(2));
				return {
					kind: 'command',
					command: RejectShareCandidate.make({
						type: 'reject-share-candidate'
					})
				};
			}
			if (verb === 'export') {
				if (value === undefined) {
					return yield* failed('missing-argument', 'share export requires a share ID.');
				}
				yield* requireNoExtra(rest);
				return {
					kind: 'command',
					command: ExportShare.make({
						type: 'export-share',
						shareId: yield* shareId(value)
					})
				};
			}
			return yield* failed('unknown-command', `Unknown share command: ${verb ?? ''}`);
		}
		case 'model':
			if (verb === 'list') {
				yield* requireNoExtra(args.slice(2));
				return { kind: 'model-list' };
			}
			if (verb === 'select') {
				if (value === 'auto') {
					yield* requireNoExtra(rest);
					return {
						kind: 'command',
						command: SelectModel.make({ type: 'select-model' })
					};
				}
				const model = value === undefined ? undefined : modelSelection(value);
				if (model === undefined) {
					return yield* failed('invalid-argument', 'Model must be provider/id or auto.');
				}
				yield* requireNoExtra(rest);
				return {
					kind: 'command',
					command: SelectModel.make({ type: 'select-model', model })
				};
			}
			if (verb === 'favorite') {
				const action = value;
				const modelValue = rest[0];
				const model = modelValue === undefined ? undefined : modelSelection(modelValue);
				if ((action !== 'add' && action !== 'remove') || model === undefined) {
					return yield* failed(
						'invalid-argument',
						'Usage: flect model favorite <add|remove> <provider/id>.'
					);
				}
				yield* requireNoExtra(rest.slice(1));
				return {
					kind: 'command',
					command: SetModelFavorite.make({
						type: 'set-model-favorite',
						model,
						favorite: action === 'add'
					})
				};
			}
			return yield* failed('unknown-command', `Unknown model command: ${verb ?? ''}`);
		case 'extensions': {
			if (verb === 'list') {
				yield* requireNoExtra(args.slice(2));
				return { kind: 'portable-extension-list' };
			}
			if (verb === 'describe' || verb === 'call') {
				if (value === undefined || !/^[a-z][a-z0-9-]{0,79}$/.test(value)) {
					return yield* failed(
						'invalid-argument',
						`Usage: flect extensions ${verb} <extension-id>${verb === 'call' ? ' [--input <json>]' : ''}.`
					);
				}
				if (verb === 'describe') {
					yield* requireNoExtra(rest);
					return { kind: 'portable-extension-describe', extensionId: value };
				}
				if (rest.length === 0) {
					return {
						kind: 'portable-extension-call',
						extensionId: value,
						input: null
					};
				}
				if (rest[0] !== '--input' || rest[1] === undefined) {
					return yield* failed(
						rest[0]?.startsWith('-') === true ? 'unknown-flag' : 'invalid-argument',
						'Usage: flect extensions call <extension-id> [--input <json>].'
					);
				}
				yield* requireNoExtra(rest.slice(2));
				const input = yield* Effect.try({
					try: (): unknown => JSON.parse(rest[1] ?? ''),
					catch: () => usage('invalid-argument', 'Portable extension input must be valid JSON.')
				}).pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
					Effect.mapError(() =>
						usage('invalid-argument', 'Portable extension input must be valid JSON.')
					)
				);
				return {
					kind: 'portable-extension-call',
					extensionId: value,
					input
				};
			}
			const role = value;
			if ((verb !== 'enable' && verb !== 'disable') || (role !== 'app' && role !== 'shaper')) {
				return yield* failed(
					'invalid-argument',
					'Usage: flect extensions <enable|disable> <app|shaper>.'
				);
			}
			yield* requireNoExtra(rest);
			return {
				kind: 'command',
				command: SetExternalExtensions.make({
					type: 'set-external-extensions',
					role,
					enabled: verb === 'enable'
				})
			};
		}
		case 'trusted-extensions': {
			const role = value;
			if ((verb !== 'enable' && verb !== 'disable') || (role !== 'app' && role !== 'shaper')) {
				return yield* failed(
					'invalid-argument',
					'Usage: flect trusted-extensions <enable|disable> <app|shaper>.'
				);
			}
			yield* requireNoExtra(rest);
			return {
				kind: 'command',
				command: SetExternalExtensions.make({
					type: 'set-external-extensions',
					role,
					enabled: verb === 'enable'
				})
			};
		}
		case 'safe':
			yield* requireNoExtra(args.slice(2));
			if (verb !== 'enter' && verb !== 'restore') {
				return yield* failed('unknown-command', `Unknown safe command: ${verb ?? ''}`);
			}
			return {
				kind: 'command',
				command:
					verb === 'enter'
						? EnterSafeMode.make({ type: 'enter-safe-mode' })
						: RestoreSafeMode.make({ type: 'restore-safe-mode' })
			};
		case 'rail':
			if (verb === 'collapse' || verb === 'expand') {
				yield* requireNoExtra(args.slice(2));
				return {
					kind: 'command',
					command: SetRailCollapsed.make({
						type: 'set-rail-collapsed',
						collapsed: verb === 'collapse'
					})
				};
			}
			if (verb === 'width') {
				const width = yield* positiveInteger(value, 'Rail width', 340);
				if (width > 520) {
					return yield* failed('invalid-argument', 'Rail width cannot exceed 520.');
				}
				yield* requireNoExtra(rest);
				return {
					kind: 'command',
					command: SetRailWidth.make({ type: 'set-rail-width', width })
				};
			}
			return yield* failed('unknown-command', `Unknown rail command: ${verb ?? ''}`);
		case 'control':
			yield* requireNoExtra(args.slice(2));
			if (verb === 'status') {
				return { kind: 'control-status' };
			}
			if (verb === 'disable') {
				return {
					kind: 'command',
					command: DisableControl.make({ type: 'disable-control' })
				};
			}
			return yield* failed('unknown-command', `Unknown control command: ${verb ?? ''}`);
		case 'context':
			if (verb !== '--host') {
				return yield* failed(
					'invalid-argument',
					'Usage: flect context --host <codex|claude|opencode>.'
				);
			}
			if (value !== 'codex' && value !== 'claude' && value !== 'opencode') {
				return yield* failed(
					'invalid-argument',
					'Context host must be codex, claude, or opencode.'
				);
			}
			yield* requireNoExtra(rest);
			return { kind: 'context', host: value };
		case 'setup':
			if (verb === 'status') {
				yield* requireNoExtra(args.slice(2));
				return { kind: 'setup-status' };
			}
			if (verb === 'shell' && (value === 'install' || value === 'remove')) {
				yield* requireNoExtra(rest);
				return { kind: 'setup-shell', action: value };
			}
			if (verb === 'agent' && (value === 'install' || value === 'remove')) {
				const agent = rest[0];
				if (agent !== 'codex' && agent !== 'claude' && agent !== 'opencode') {
					return yield* failed('invalid-argument', 'Agent must be codex, claude, or opencode.');
				}
				yield* requireNoExtra(rest.slice(1));
				return { kind: 'setup-agent', action: value, agent };
			}
			if (verb === 'uninstall' && (value === 'inspect' || value === 'prepare')) {
				yield* requireNoExtra(rest);
				return { kind: 'setup-uninstall', action: value };
			}
			return yield* failed('unknown-command', `Unknown setup command: ${verb ?? ''}`);
		default:
			return yield* failed('unknown-command', `Unknown command: ${noun}`, [
				'Run `flect --help` for the command reference'
			]);
	}
});

export const parseAxiArguments = Effect.fn('Flect.Axi.parseArguments')(function* (
	argv: ReadonlyArray<string>,
	audience: AxiAudience
) {
	let index = 0;
	let format: AxiFormat = 'toon';
	let full = false;
	while (index < argv.length) {
		const value = argv[index];
		if (value === '--json') {
			format = 'json';
			index += 1;
		} else if (value === '--full') {
			full = true;
			index += 1;
		} else {
			break;
		}
	}
	const command = yield* parseCommand(argv.slice(index));
	return { audience, format, full, command } satisfies ParsedAxiArguments;
});
