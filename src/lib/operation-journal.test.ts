import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
	ControlCommandSource,
	OperationRecord,
	ToolActivity,
	UserCommandSource
} from '../../shared/control';
import { ProductCapabilityReceipt } from '../../shared/product-capability';
import { RevisionId } from '../../shared/revisions';
import {
	OperationJournal,
	OperationJournalInput,
	OperationJournalLive,
	OperationQuery
} from './operation-journal';

const user = UserCommandSource.make({ kind: 'user' });
const control = ControlCommandSource.make({
	kind: 'control',
	clientId: 'client-external-1',
	clientName: 'Outside coding agent'
});

const input = (index: number, overrides: Partial<typeof OperationJournalInput.Type> = {}) =>
	OperationJournalInput.make({
		version: 1,
		operationId: `operation-journal-${index}`,
		commandId: `cmd-journal-${index}`,
		workspaceId: 'workspace-journal-1',
		source: user,
		category: 'command',
		phase: 'started',
		summary: `Operation ${index}`,
		...overrides
	});

describe('OperationJournal', () => {
	it.layer(OperationJournalLive)((it) => {
		it.effect('keeps correlated lifecycle evidence in monotonic order', () =>
			Effect.gen(function* () {
				const journal = yield* OperationJournal;
				const started = yield* journal.append(
					input(1, {
						sessionId: 'session-private-1',
						role: 'shaper'
					})
				);
				const completed = yield* journal.append(
					input(1, {
						category: 'revision',
						phase: 'succeeded',
						summary: 'Revision accepted',
						revisionId: RevisionId.make('revision-2')
					})
				);

				assert.strictEqual(started.sequence, 1);
				assert.strictEqual(completed.sequence, 2);
				assert.strictEqual(started.operationId, completed.operationId);
				assert.strictEqual(started.commandId, completed.commandId);
				assert.strictEqual(started.sessionId, 'session-private-1');
				assert.strictEqual(completed.revisionId, 'revision-2');
			})
		);

		it.effect('queries role, phase, category, tool, revision, and client', () =>
			Effect.gen(function* () {
				const journal = yield* OperationJournal;
				const tool = ToolActivity.make({
					version: 1,
					id: 'activity-journal-tool',
					callId: 'tool-call-1',
					operationId: 'operation-journal-tool',
					role: 'app',
					toolName: 'bash',
					phase: 'failed',
					startedAt: 10,
					updatedAt: 20,
					completedAt: 20,
					durationMs: 10,
					resultSummary: 'Tool failed',
					exitCode: 1
				});
				yield* journal.append(
					input(2, {
						operationId: 'operation-journal-tool',
						source: control,
						category: 'tool',
						phase: 'failed',
						summary: 'Bash failed',
						role: 'app',
						toolCallId: 'tool-call-1',
						clientId: 'client-external-1',
						tool
					})
				);
				yield* journal.append(
					input(3, {
						category: 'revision',
						phase: 'succeeded',
						summary: 'Revision accepted',
						revisionId: RevisionId.make('revision-3')
					})
				);

				const failures = yield* journal.query(
					OperationQuery.make({
						role: 'app',
						category: 'tool',
						toolName: 'bash',
						clientId: 'client-external-1',
						failuresOnly: true
					})
				);
				const revisions = yield* journal.query(
					OperationQuery.make({
						revisionId: RevisionId.make('revision-3'),
						phase: 'succeeded'
					})
				);

				assert.strictEqual(failures.length, 1);
				assert.strictEqual(failures[0]?.toolCallId, 'tool-call-1');
				assert.strictEqual(revisions.length, 1);
				assert.strictEqual(revisions[0]?.category, 'revision');
			})
		);

		it.effect('stores and queries a bounded capability receipt without payloads', () =>
			Effect.gen(function* () {
				const journal = yield* OperationJournal;
				const capability = ProductCapabilityReceipt.make({
					version: 1,
					scopeId: 'dev.akua.projects',
					workspaceId: 'workspace-journal-1',
					requestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
					revision: 'revision-projects-1',
					capabilityId: 'product.projects.read',
					decisionId: 'decision-capability-0001',
					confirmationPolicy: 'session',
					operationId: 'projects.list',
					result: 'succeeded'
				});
				const record = yield* journal.append(
					input(31, {
						category: 'capability',
						phase: 'succeeded',
						summary: 'Product operation completed',
						capability
					})
				);

				assert.deepStrictEqual(record.capability, capability);
				assert.deepStrictEqual(
					yield* journal.query(OperationQuery.make({ capabilityId: 'product.projects.read' })),
					[record]
				);
				assert.notProperty(record.capability, 'input');
				assert.notProperty(record.capability, 'output');
			})
		);

		it.effect('redacts authorization and provider-secret material at append', () =>
			Effect.gen(function* () {
				const journal = yield* OperationJournal;
				const record = yield* journal.append(
					input(4, {
						summary: 'Authorization: Bearer super-secret-token with sk-provider-secret',
						tool: ToolActivity.make({
							version: 1,
							id: 'activity-journal-secret',
							callId: 'tool-call-secret',
							operationId: 'operation-journal-4',
							role: 'app',
							toolName: 'bash',
							phase: 'succeeded',
							startedAt: 10,
							updatedAt: 20,
							command: "curl -H 'Authorization: Bearer command-secret'",
							output: 'api_key=output-secret ghp_1234567890abcdefghij'
						})
					})
				);
				const encoded = JSON.stringify(record);

				assert.notInclude(encoded, 'super-secret-token');
				assert.notInclude(encoded, 'provider-secret');
				assert.notInclude(encoded, 'command-secret');
				assert.notInclude(encoded, 'output-secret');
				assert.notInclude(encoded, 'ghp_1234567890abcdefghij');
				assert.include(encoded, '[REDACTED]');
			})
		);

		it.effect('evicts the oldest records beyond the recent 128-record bound', () =>
			Effect.gen(function* () {
				const journal = yield* OperationJournal;
				yield* Effect.forEach(
					Array.from({ length: 501 }, (_, index) => index + 1),
					(index) => journal.append(input(index)),
					{ discard: true }
				);
				const records = yield* journal.snapshot;

				assert.strictEqual(records.length, 128);
				assert.strictEqual(records[0]?.sequence, (records.at(-1)?.sequence ?? 0) - 127);
				assert.strictEqual(records[0]?.operationId, 'operation-journal-374');
				assert.strictEqual(records.at(-1)?.operationId, 'operation-journal-501');
			})
		);

		it.effect('evicts records before encoded state exceeds 512 KiB', () =>
			Effect.gen(function* () {
				const journal = yield* OperationJournal;
				const output = 'x'.repeat(8_000);
				yield* Effect.forEach(
					Array.from({ length: 300 }, (_, index) => index + 1),
					(index) =>
						journal.append(
							input(index, {
								category: 'tool',
								tool: ToolActivity.make({
									version: 1,
									id: `activity-sized-${index}-entry`,
									callId: `tool-call-sized-${index}`,
									operationId: `operation-journal-${index}`,
									role: 'shaper',
									toolName: 'bash',
									phase: 'succeeded',
									startedAt: index,
									updatedAt: index,
									output
								})
							})
						),
					{ discard: true }
				);
				const records = yield* journal.snapshot;
				const encodedBytes = new TextEncoder().encode(
					JSON.stringify(
						yield* Effect.forEach(records, (record) => Effect.succeed(OperationRecord.make(record)))
					)
				).byteLength;

				assert.isBelow(records.length, 128);
				assert.isAtMost(encodedBytes, 512 * 1024);
				assert.strictEqual(records.at(-1)?.operationId, 'operation-journal-300');
			})
		);
	});
});
