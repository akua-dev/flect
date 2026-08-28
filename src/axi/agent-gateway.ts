import { Effect, Layer, Schema, Stream } from 'effect';
import {
	type AgentCommandSource,
	type FlectCommandError,
	FlectCommandReceipt,
	FlectWorkspaceSnapshot
} from '../../shared/control';
import { ControlBrokerStatus, ControlLogsResponse } from '../../shared/control-channel';
import { validateInterfaceDocument } from '../../shared/interface-document';
import {
	importWebProject,
	type WebProjectFile,
	type WebProjectImportResult
} from '../lib/web-project-import';
import { AgentCommandBus, type AgentCommandBusError } from './agent-command-bus';
import {
	type AuthoredAppSummary,
	FlectCommandGateway,
	FlectGatewayError,
	FlectInterfaceCommandGateway
} from './gateway';

const gatewayError = (message: string) =>
	FlectGatewayError.make({ reason: 'unavailable', message });

const decode = <A, R>(schema: Schema.ConstraintDecoder<A, R>, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value).pipe(
		Effect.mapError(() =>
			FlectGatewayError.make({
				reason: 'invalid-response',
				message: 'The embedded Flect command returned an invalid response.'
			})
		)
	);

const mapBusError = (error: AgentCommandBusError | FlectCommandError | FlectGatewayError) =>
	error._tag === 'AgentCommandBusError' ? gatewayError(error.message) : error;

export const makeAgentFlectCommandGatewayLayer = (
	source: AgentCommandSource,
	readInterface?: (path: string) => Effect.Effect<unknown, FlectGatewayError>,
	readAppSource?: (
		directory: string
	) => Effect.Effect<ReadonlyArray<WebProjectFile>, FlectGatewayError>
) => {
	const commandLayer = Layer.effect(
		FlectCommandGateway,
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			const inspect = bus.submit(source, { type: 'inspect' }).pipe(
				Effect.mapError((error) =>
					error._tag === 'AgentCommandBusError'
						? gatewayError(error.message)
						: gatewayError('The embedded Flect workspace is unavailable.')
				),
				Effect.flatMap((result) => decode(FlectWorkspaceSnapshot, result.value))
			);
			return {
				audience: source.role,
				binding: source.binding ?? (source.role === 'app' ? 'accepted' : 'candidate'),
				bin: 'flect',
				status: inspect.pipe(
					Effect.map((snapshot) =>
						ControlBrokerStatus.make({
							version: 1,
							enabled: true,
							connected: true,
							port: 1,
							workspaceId: snapshot.workspaceId,
							url: 'browser-embedded'
						})
					)
				),
				inspect,
				logs: bus.submit(source, { type: 'logs' }).pipe(
					Effect.mapError(() => gatewayError('The embedded Flect logs are unavailable.')),
					Effect.flatMap((result) => decode(ControlLogsResponse, result.value))
				),
				events: () =>
					Stream.fail(
						FlectGatewayError.make({
							reason: 'unsupported',
							message: 'Embedded event watching is unavailable.'
						})
					),
				command: (command) =>
					bus.submit(source, { type: 'command', command }).pipe(
						Effect.mapError(mapBusError),
						Effect.flatMap((result) => decode(FlectCommandReceipt, result.value))
					)
			};
		})
	);
	if (readInterface === undefined) {
		return commandLayer;
	}
	const validate = Effect.fn('AgentGateway.validateInterface')((path: string) =>
		readInterface(path).pipe(
			Effect.flatMap(validateInterfaceDocument),
			Effect.mapError((error) =>
				error._tag === 'FlectGatewayError'
					? error
					: FlectGatewayError.make({
							reason: 'invalid-response',
							message: 'The interface document is invalid.'
						})
			)
		)
	);
	const packageApp = Effect.fn('AgentGateway.packageApp')(function* (
		directory: string,
		name: string | undefined
	) {
		if (readAppSource === undefined) {
			return yield* Effect.fail(
				FlectGatewayError.make({
					reason: 'unsupported',
					message: 'App source packaging requires the sandbox adapter.'
				})
			);
		}
		const files = yield* readAppSource(directory);
		return yield* importWebProject(files, {
			source: 'conversation',
			revision: 'conversation',
			...(name === undefined ? {} : { name })
		}).pipe(
			Effect.mapError((error) =>
				FlectGatewayError.make({
					reason: 'invalid-response',
					message: error.message.slice(0, 500)
				})
			)
		);
	});
	const appSummary = (report: WebProjectImportResult['report']): AuthoredAppSummary => ({
		name: report.name,
		kind: report.kind,
		entrypoint: report.entrypoint,
		includedFiles: report.includedFiles,
		warnings: [...report.warnings]
	});
	const interfaceLayer = Layer.effect(
		FlectInterfaceCommandGateway,
		Effect.gen(function* () {
			const bus = yield* AgentCommandBus;
			return {
				validate,
				propose: (path: string) =>
					validate(path).pipe(
						Effect.flatMap((document) =>
							bus.submit(source, { type: 'propose-interface', document })
						),
						Effect.map((result) => result.value),
						Effect.mapError(mapBusError)
					),
				validateApp: (directory: string, name?: string) =>
					packageApp(directory, name).pipe(Effect.map((result) => appSummary(result.report))),
				proposeApp: (directory: string, name?: string) =>
					packageApp(directory, name).pipe(
						Effect.flatMap((result) =>
							bus
								.submit(source, {
									type: 'propose-app',
									archive: result.archive,
									name: result.report.name
								})
								.pipe(Effect.mapError(mapBusError))
						),
						Effect.map((result) => result.value)
					)
			};
		})
	);
	return Layer.merge(commandLayer, interfaceLayer);
};
