import { describe, expect, it } from 'vitest';
import {
	advanceRemoteProtocolFixture,
	initialRemoteProtocolFixtureState,
	type RemoteProtocolFixtureEvent,
	RemoteProtocolFixtureFailure,
	type RemoteProtocolFixtureState
} from './remote-runtime-protocol-fixture';

const apply = (state: RemoteProtocolFixtureState, event: RemoteProtocolFixtureEvent) => {
	const next = advanceRemoteProtocolFixture(state, event);
	if (next instanceof RemoteProtocolFixtureFailure) {
		throw new Error(`fixture failed: ${next.reason}`);
	}
	return next;
};

const paired = () => {
	const pairing = apply(initialRemoteProtocolFixtureState(), {
		type: 'start-pairing',
		deviceId: 'device-browser-1',
		runtimeId: 'runtime-home-1'
	});
	return apply(pairing, {
		type: 'confirm-pairing',
		sessionId: 'session-initial-1'
	});
};

describe('remote runtime protocol fixture', () => {
	it('requires explicit pairing before a session becomes active', () => {
		const state = paired();
		expect(state.phase).toBe('active');
		expect(state.deviceId).toBe('device-browser-1');
		expect(state.runtimeId).toBe('runtime-home-1');
	});

	it('rejects replay and the wrong key epoch', () => {
		const accepted = apply(paired(), {
			type: 'accept-frame',
			keyEpoch: 1,
			sequence: 1
		});
		const replay = advanceRemoteProtocolFixture(accepted, {
			type: 'accept-frame',
			keyEpoch: 1,
			sequence: 1
		});
		const staleEpoch = advanceRemoteProtocolFixture(accepted, {
			type: 'accept-frame',
			keyEpoch: 2,
			sequence: 2
		});
		expect(replay).toMatchObject({ reason: 'replay' });
		expect(staleEpoch).toMatchObject({ reason: 'wrong-key-epoch' });
	});

	it('resumes without resetting the accepted sequence', () => {
		const accepted = apply(paired(), {
			type: 'accept-frame',
			keyEpoch: 1,
			sequence: 7
		});
		const disconnected = apply(accepted, { type: 'disconnect' });
		const resumed = apply(disconnected, {
			type: 'resume',
			sessionId: 'session-resumed-1',
			keyEpoch: 1
		});
		expect(resumed.phase).toBe('active');
		expect(resumed.lastReceivedSequence).toBe(7);
	});

	it('makes interruption idempotent', () => {
		const interrupted = apply(paired(), {
			type: 'interrupt',
			operationId: 'operation-agent-1'
		});
		const repeated = apply(interrupted, {
			type: 'interrupt',
			operationId: 'operation-agent-1'
		});
		expect(repeated.interruptedOperationIds).toEqual(['operation-agent-1']);
	});

	it('blocks every event after revocation until protected recovery rotates keys', () => {
		const revoked = apply(paired(), { type: 'revoke' });
		expect(
			advanceRemoteProtocolFixture(revoked, {
				type: 'resume',
				sessionId: 'session-rejected-1',
				keyEpoch: 1
			})
		).toMatchObject({ reason: 'revoked' });
		const recovered = apply(revoked, { type: 'recover', keyEpoch: 2 });
		expect(recovered).toMatchObject({ phase: 'unpaired', keyEpoch: 2 });
	});

	it('requires a new pairing after lost-device recovery', () => {
		const lost = apply(paired(), { type: 'lose-device' });
		expect(lost.phase).toBe('lost');
		const recovered = apply(lost, { type: 'recover', keyEpoch: 2 });
		expect(recovered).toMatchObject({
			phase: 'unpaired',
			keyEpoch: 2,
			lastReceivedSequence: 0
		});
		expect(recovered.deviceId).toBeUndefined();
		expect(recovered.sessionId).toBeUndefined();
	});
});
