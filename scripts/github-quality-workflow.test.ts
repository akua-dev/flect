import { readFile } from 'node:fs/promises';
import { assert, describe, it } from '@effect/vitest';
import { parse } from 'yaml';

type JsonRecord = Record<string, unknown>;

function assertMapping(value: unknown, label: string): asserts value is JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		assert.fail(`${label} must be a mapping`);
		throw new Error(`${label} must be a mapping`);
	}
}

const record = (value: unknown, label: string): JsonRecord => {
	assertMapping(value, label);
	return value;
};

const loadWorkflow = async () => {
	const source = await readFile('.github/workflows/quality.yml', 'utf8');
	const workflow = record(parse(source, { uniqueKeys: true }), 'quality workflow');
	return { source, workflow };
};

const jobRecord = (workflow: JsonRecord, id: string): JsonRecord =>
	record(record(workflow.jobs, 'workflow jobs')[id], `${id} job`);

function assertStepList(value: unknown, label: string): asserts value is ReadonlyArray<JsonRecord> {
	if (!Array.isArray(value)) {
		assert.fail(`${label} steps must be a list`);
		throw new Error(`${label} steps must be a list`);
	}
}

const jobSteps = (job: JsonRecord, label: string) => {
	const steps = job.steps;
	assertStepList(steps, label);
	return steps;
};

const actionSteps = (steps: ReadonlyArray<JsonRecord>) =>
	steps.filter(
		(step): step is JsonRecord & { readonly uses: string } => typeof step.uses === 'string'
	);

const findAction = (steps: ReadonlyArray<JsonRecord>, prefix: string, label: string) => {
	const step = actionSteps(steps).find((candidate) => candidate.uses.startsWith(prefix));
	if (step === undefined) {
		assert.fail(`${label} requires a ${prefix} step`);
		throw new Error(`${label} requires a ${prefix} step`);
	}
	return step;
};

const runCommands = (steps: ReadonlyArray<JsonRecord>) =>
	steps.flatMap((step) => (typeof step.run === 'string' ? [step.run] : []));

describe('GitHub quality workflow', () => {
	it('keeps the credential-free triggers, permissions, and concurrency', async () => {
		const { source, workflow } = await loadWorkflow();
		assert.notInclude(source, 'secrets.');
		assert.notInclude(source, 'pull_request_target');

		assert.strictEqual(workflow.name, 'Flect quality');
		assert.deepStrictEqual(workflow.permissions, { contents: 'read' });

		const triggers = record(workflow.on, 'workflow triggers');
		assert.deepStrictEqual(Object.keys(triggers).sort(), [
			'pull_request',
			'push',
			'workflow_dispatch'
		]);
		assert.deepStrictEqual(record(triggers.pull_request, 'pull request trigger').branches, [
			'main'
		]);
		assert.deepStrictEqual(record(triggers.push, 'push trigger').branches, ['main']);
		assert.deepStrictEqual(
			record(record(triggers.workflow_dispatch, 'manual trigger').inputs, 'manual trigger inputs')
				.failure_probe,
			{
				description: 'Prove that the public quality check fails closed',
				required: false,
				type: 'boolean',
				default: false
			}
		);

		const concurrency = record(workflow.concurrency, 'workflow concurrency');
		assert.strictEqual(concurrency['cancel-in-progress'], true);
		assert.match(String(concurrency.group), /github\.workflow/);
		assert.match(String(concurrency.group), /github\.ref/);
	});

	it('pins every action by commit and never persists credentials', async () => {
		const { workflow } = await loadWorkflow();
		const jobs = record(workflow.jobs, 'workflow jobs');
		assert.deepStrictEqual(Object.keys(jobs).sort(), [
			'bazel',
			'changes',
			'desktop',
			'e2e',
			'gate'
		]);

		for (const [id, value] of Object.entries(jobs)) {
			const job = record(value, `${id} job`);
			const timeout = job['timeout-minutes'];
			assert.strictEqual(typeof timeout, 'number', `${id} must declare a timeout`);
			assert.isAtMost(Number(timeout), 45, `${id} timeout must stay bounded`);

			for (const step of actionSteps(jobSteps(job, id))) {
				assert.match(
					step.uses,
					/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/,
					`${id} must pin ${step.uses} to a full commit`
				);
				if (step.uses.startsWith('actions/checkout@')) {
					assert.deepStrictEqual(step.with, { 'persist-credentials': false });
				}
				if (step.uses.startsWith('oven-sh/setup-bun@')) {
					assert.deepStrictEqual(step.with, { 'bun-version': '1.3.14' });
				}
			}
		}
	});

	it('classifies documentation-only pull requests conservatively', async () => {
		const { workflow } = await loadWorkflow();
		const changes = jobRecord(workflow, 'changes');
		assert.strictEqual(changes['runs-on'], 'ubuntu-latest');
		assert.deepStrictEqual(changes.permissions, {
			contents: 'read',
			'pull-requests': 'read'
		});
		assert.deepStrictEqual(changes.outputs, {
			code: '${{ steps.filter.outputs.code }}'
		});

		const filter = findAction(jobSteps(changes, 'changes'), 'dorny/paths-filter@', 'changes');
		assert.strictEqual(filter.uses, 'dorny/paths-filter@ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d');
		assert.strictEqual(
			filter.if,
			"github.event_name == 'pull_request'",
			'only pull requests may take the documentation fast path'
		);
		const inputs = record(filter.with, 'filter inputs');
		assert.strictEqual(inputs['predicate-quantifier'], 'every');
		const filters = record(parse(String(inputs.filters)), 'path filter definition');
		assert.deepStrictEqual(filters.code, ['!**/*.md', '!docs/**', '!.agents/**']);
	});

	it('runs the full canonical gate commands across the parallel jobs', async () => {
		const { workflow } = await loadWorkflow();

		const bazel = jobRecord(workflow, 'bazel');
		assert.strictEqual(bazel['runs-on'], 'ubuntu-latest');
		const bazelCommands = runCommands(jobSteps(bazel, 'bazel'));
		assert.include(bazelCommands, 'bazel test //... --keep_going --jobs=4');

		const codeChangedCondition =
			"github.event_name != 'pull_request' || needs.changes.outputs.code == 'true'";

		const e2e = jobRecord(workflow, 'e2e');
		assert.strictEqual(e2e['runs-on'], 'ubuntu-latest');
		assert.strictEqual(e2e.needs, 'changes');
		assert.strictEqual(e2e.if, codeChangedCondition);
		const e2eCommands = runCommands(jobSteps(e2e, 'e2e'));
		assert.include(e2eCommands, 'bun install --frozen-lockfile');
		assert.include(e2eCommands, './node_modules/.bin/playwright install --with-deps chromium');
		assert.include(e2eCommands, 'bun run test:e2e');

		const desktop = jobRecord(workflow, 'desktop');
		assert.strictEqual(desktop['runs-on'], 'macos-15');
		assert.strictEqual(
			desktop.needs,
			'changes',
			'desktop must not wait on e2e; the macOS jobs run in parallel'
		);
		assert.strictEqual(desktop.if, codeChangedCondition);
		const desktopSteps = jobSteps(desktop, 'desktop');

		const toolchain = findAction(desktopSteps, 'dtolnay/rust-toolchain@', 'desktop');
		assert.strictEqual(
			toolchain.uses,
			'dtolnay/rust-toolchain@2c7215f132e9ebf062739d9130488b56d53c060c'
		);
		assert.deepStrictEqual(toolchain.with, {
			toolchain: '1.93.0',
			components: 'rustfmt'
		});

		const rustCache = findAction(desktopSteps, 'Swatinem/rust-cache@', 'desktop');
		assert.strictEqual(
			rustCache.uses,
			'Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6'
		);
		assert.deepStrictEqual(rustCache.with, { workspaces: 'src-tauri' });

		const desktopCommands = runCommands(desktopSteps);
		assert.include(desktopCommands, 'bun install --frozen-lockfile');
		assert.include(desktopCommands, 'bun run build:sidecar');
		assert.include(desktopCommands, 'cargo fmt --manifest-path src-tauri/Cargo.toml --check');
		assert.include(desktopCommands, 'cargo test --manifest-path src-tauri/Cargo.toml');
		const bundleCommand = desktopCommands.find((command) => command.includes('tauri build'));
		assert.isDefined(bundleCommand, 'desktop must build the bundle');
		assert.include(String(bundleCommand), '--bundles app');
		assert.notInclude(
			String(bundleCommand),
			'beforeBuildCommand',
			'the stock beforeBuildCommand must build the clean production frontend'
		);
		assert.include(
			String(bundleCommand),
			'"signingIdentity":"-"',
			'the bundle build must request an explicit ad-hoc signature'
		);
	});

	it('uploads only bounded browser failure evidence', async () => {
		const { workflow } = await loadWorkflow();

		const e2eSteps = jobSteps(jobRecord(workflow, 'e2e'), 'e2e');
		const uploads = actionSteps(e2eSteps).filter((step) =>
			step.uses.startsWith('actions/upload-artifact@')
		);
		assert.lengthOf(uploads, 1, 'e2e uploads only failure evidence');
		const evidence = uploads[0];
		assert.strictEqual(
			evidence.uses,
			'actions/upload-artifact@330a01c490aca151604b8cf639adc76d48f6c5d4'
		);
		assert.strictEqual(evidence.if, 'failure() && !cancelled()');
		const evidenceInputs = record(evidence.with, 'evidence inputs');
		assert.strictEqual(evidenceInputs['retention-days'], 7);
		assert.strictEqual(evidenceInputs['include-hidden-files'], false);
		assert.strictEqual(evidenceInputs.path, 'test-results/**\n!test-results/control-state/**\n');
	});

	it('keeps the required summary check always reporting and failing closed', async () => {
		const { workflow } = await loadWorkflow();
		const gate = jobRecord(workflow, 'gate');
		assert.strictEqual(gate.name, 'Flect quality gate');
		assert.strictEqual(gate['runs-on'], 'ubuntu-latest');
		assert.strictEqual(gate.if, 'always()');
		assert.deepStrictEqual(gate.needs, ['changes', 'bazel', 'e2e', 'desktop']);

		const steps = jobSteps(gate, 'gate');
		const probe = steps.find((step) => String(step.run).includes('exit 1'));
		assert.isDefined(probe, 'the deliberate failure probe must remain');
		assert.strictEqual(
			probe?.if,
			"github.event_name == 'workflow_dispatch' && inputs.failure_probe"
		);

		const aggregate = steps.find((step) => String(step.run).includes('did not succeed'));
		assert.isDefined(aggregate, 'the gate must aggregate every needed job');
		const env = record(aggregate?.env, 'gate aggregation env');
		assert.strictEqual(env.CHANGES_RESULT, '${{ needs.changes.result }}');
		assert.strictEqual(env.BAZEL_RESULT, '${{ needs.bazel.result }}');
		assert.strictEqual(env.E2E_RESULT, '${{ needs.e2e.result }}');
		assert.strictEqual(env.DESKTOP_RESULT, '${{ needs.desktop.result }}');
		assert.strictEqual(
			env.DOCS_ONLY,
			"${{ github.event_name == 'pull_request' && needs.changes.outputs.code != 'true' }}"
		);
		const script = String(aggregate?.run);
		assert.include(script, 'require changes "$CHANGES_RESULT" false');
		assert.include(script, 'require bazel "$BAZEL_RESULT" false');
		assert.include(script, 'require e2e "$E2E_RESULT" true');
		assert.include(script, 'require desktop "$DESKTOP_RESULT" true');
	});

	it('pins the local toolchains and builds the Rust sidecar in check:all', async () => {
		const packageJson = record(JSON.parse(await readFile('package.json', 'utf8')), 'package.json');
		assert.strictEqual(packageJson.packageManager, 'bun@1.3.14');
		const scripts = record(packageJson.scripts, 'package scripts');
		assert.strictEqual(
			scripts['check:rust'],
			'bun run build:sidecar && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo test --manifest-path src-tauri/Cargo.toml'
		);
		assert.match(String(scripts['check:all']), /bun run check:rust/);
	});
});
