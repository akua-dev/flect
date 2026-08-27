import type { Effect } from 'effect';
import { type DecodedCapsule, decodeCapsule, type InvalidCapsule } from '../shared/capsule';

// Native hosts read bytes through their platform picker, then enter the exact
// same portable decoder as the browser. No host-specific manifest exists.
export const loadDesktopCapsule: (
	archive: Uint8Array
) => Effect.Effect<DecodedCapsule, InvalidCapsule> = decodeCapsule;
