# Updates and uninstall

Flect keeps native application replacement separate from user work. The browser
build remains complete without a native updater and reports that desktop updates
are unavailable.

## Updating the desktop app

Open **Diagnostics → Flect updates** in the installed macOS app. A public build
checks only Flect's fixed HTTPS GitHub Release manifest. If a newer Apple-silicon
version exists, Flect shows its version, bounded release notes, target, and size
before asking for confirmation. Tauri verifies the archive's Minisign signature
with the public key compiled into that release. The opaque candidate token is
single-use and a newer check invalidates an older candidate.

Only the compiled main Flect window has this native authority. Capsules, shaped
interfaces, the internal App/Preview/Shaper/Guardian authorities behind the one
Flect conversation, portable extensions, embedded Bash, product adapters, Local
control, AXI, and MCP cannot check, install, or relaunch an application update.
Development builds intentionally say that no trusted update key is configured.

The private update key is never part of Flect. Public packaging reads it only
from Tauri's release environment. The package gate verifies the generated
archive against the corresponding public key, writes `latest.json`, and records
only public-key and artifact digests in release evidence.

## Preparing to uninstall

Open **Diagnostics → Native setup → Uninstall Flect** and choose **Prepare to
uninstall**. Flect first disables Local control, then removes only integrations
that still carry Flect's ownership markers:

- the `~/.local/bin/flect` symlink, when it points into a Flect app;
- Flect-owned Codex and Claude Code context hooks; and
- the Flect-owned OpenCode plugin.

Absent items stay absent. Foreign links, regular files, malformed or unrelated
agent configuration, and conflicting plugin paths are preserved and reported as
conflicts. Preparation never recursively removes a directory and never removes
the application bundle.

The same bounded plan is available to an outside native agent:

```text
flect setup uninstall inspect --json
flect setup uninstall prepare --json
```

After preparation, move the exact app path shown by Flect to Trash.

## Data retained by default

Uninstall preparation and moving the app to Trash retain:

- interface workspaces, revisions, and installed experiences;
- provider authentication owned by Pi or the provider; and
- files the user exported outside Flect.

This is deliberate. A future data-erasure workflow must enumerate and confirm
each owned store separately; it must not be hidden inside application uninstall.

## Public-release boundary

A public update is not claimed unless the source is clean and tagged, the app is
Developer ID signed and notarized, Gatekeeper accepts it, the ticket is stapled,
the updater archive and signature verify, and independently built unsigned app
content matches exactly. Current Tauri Isolation code generation includes fresh
security material, so public reproducibility remains fail-closed until that
upstream boundary has a reviewed deterministic input.
