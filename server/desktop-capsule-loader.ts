import { decodeCapsule } from '../shared/capsule';

// Native hosts read bytes through their platform picker, then enter the exact
// same portable decoder as the browser. No host-specific manifest exists.
export const loadDesktopCapsule = decodeCapsule;
