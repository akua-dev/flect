# Packaged macOS local verification — 2026-08-10

## Outcome

The current ad-hoc-signed Apple Silicon bundle now has a reproducible,
credential-free packaged-host recovery gate. It copies the built application to
a temporary location, assigns a random test-only bundle identifier, re-signs
that isolated copy, gives its Pi sidecar a temporary home directory, and drives
the real WKWebView through the macOS Accessibility tree. It never opens,
changes, or deletes the ordinary Flect or Pi profile.

The run exposed and fixed a first-run defect: a clean Pi profile disabled the
draft and ended at a passive **Try again** action. The protected composer now
keeps the first message editable, presents **OpenAI (ChatGPT Plus/Pro)** as the
direct recommended login, and hides the other 37 discovered providers behind
progressive disclosure. Credential entry and provider authorization still stay
inside Pi's private runtime.

## Reproducible command

```bash
PATH=/Users/robin/.cargo/bin:$PATH bun run build:desktop -- --bundles app
bun run test:desktop:local
```

`test:desktop:local` requires macOS Accessibility permission for the invoking
terminal. It creates only a random `dev.akua.flect.verification.*` profile and
temporary Pi home, then removes those exact test-owned paths and bundle after
the run.

## Observable proof

The final local run returned:

```json
{
  "type": "flect-packaged-macos",
  "signature": "verified-ad-hoc",
  "isolatedBundle": true,
  "isolatedPiHome": true,
  "actionableProviderSetup": true,
  "passiveRetryAbsent": true,
  "editableFirstDraft": true,
  "nativeMenus": true,
  "nativeWindowControls": 3,
  "minimumWindow": [760, 560],
  "mainSurvivedSidecarKill": true,
  "restoredDraft": true,
  "relaunchedSidecar": true,
  "windows": 1
}
```

This proves on the actual packaged host that:

- the ad-hoc signature verifies before launch;
- a clean profile exposes one direct provider action and no passive retry dead
  end;
- the first unsent message remains editable while authentication is pending;
- standard Edit/Window/Help menus, three native traffic-light controls, and the
  760 × 560 minimum window constraint are exposed by AppKit;
- the exact private draft persists without entering public workspace or Git
  state;
- a hard private-sidecar loss does not terminate the main application or lose
  that draft;
- terminating and relaunching the exact isolated bundle restores the draft,
  starts one new private runtime, and owns exactly one Flect window; and
- all test-owned WebKit/cache state is scoped by the random bundle identifier
  and removed after verification.

## Remaining external boundary

This local gate deliberately uses no real provider credential, Developer ID,
notarization service, clean second machine, spoken VoiceOver session, or
trackpad hardware trace. A successful real provider callback/turn, recorded
VoiceOver walkthrough, Developer ID/notarization proof, independent security
review, and clean-machine distribution remain external evidence. They are not
represented by the deterministic local gate.
