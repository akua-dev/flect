# Native platform adapters

Flect keeps product state, the live canvas, Git history, agent coordination,
and capability decisions in the shared Effect application. Native adapters are
small host-owned enhancements behind that boundary; they are not a second
application architecture and do not make WebView controls pretend to be native
controls.

## Implemented macOS adapter

The first adapter reads the current macOS control accent color:

1. `FlectNative.swift` asks AppKit for `NSColor.controlAccentColor` and returns
   one packed RGBA value through a fixed C ABI symbol.
2. The Tauri Rust host converts that value to a closed, versioned JSON result
   containing only a CSS color and readable black/white contrast color.
3. `NativePlatform` schema-decodes the result and returns a typed unavailable
   or invalid-result failure without exposing native error details.
4. The product operation registry exposes `native.appearance.current` only on
   the Tauri composition root and only after the protected capability broker
   has reserved and validated an explicit grant for
   `product:native-appearance:read`.

The Swift adapter cannot see interface revisions, Git, Pi, credentials,
capsules, or the capability store. It owns no long-lived resource. Browser
composition uses the same `NativePlatform` contract with a typed unavailable
result, while the shared capsule continues rendering without the enhancement.
Revocation is checked before every invocation, so it prevents another AppKit
read immediately.

## Adapter rules

Every additional Windows, Linux, iOS, Android, or macOS adapter must follow the
same pattern:

- define the smallest versioned input and output schema in shared code;
- expose a fixed host command rather than a general native bridge;
- keep native code unable to read application state it does not require;
- register the operation and manifest only in composition roots that genuinely
  support it;
- reserve, authorize, validate, execute, and audit through the product
  capability broker;
- map unsupported hosts and rejected native results to bounded typed failures;
- put allocated handles, listeners, streams, and tasks in an Effect scope so
  interruption, revocation, and shutdown release them; and
- prove absence before approval, success after approval, denial after
  revocation, and explicit unsupported-host behavior in tests.

Platform chrome still belongs to the platform. Menus, dialogs, window
lifecycle, shortcuts, safe areas, accessibility, and input behavior should use
the actual host facilities when a web surface cannot satisfy the native-feel
gate. A platform adapter is never permission to load capsule-provided native
libraries or executables.
