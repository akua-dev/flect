# Final delivery verification — 2026-08-11

## Result

The vision implementation at commit `a7812a0` is published on
[PR #38](https://github.com/akua-dev/flect/pull/38), passes the canonical
credential-free hosted gate, and is protected by a real `main` branch rule.
The same public workflow also proved that an explicitly requested failure
cannot report success.

This report separates implementation evidence from authorities that cannot be
created by source code or an untrusted pull-request workflow. It does not claim
an Apple identity, provider login, npm publisher, independent security review,
human VoiceOver walkthrough, or clean external machine that was not present.

## Hosted GitHub gate and repository policy

- [Run 31436336436](https://github.com/akua-dev/flect/actions/runs/31436336436)
  completed successfully on `a7812a0`. The `Flect quality gate` ran from
  21:59:21 to 22:15:36 UTC and executed the repository-owned `bun run
  check:all` command.
- [Run 31436397823](https://github.com/akua-dev/flect/actions/runs/31436397823)
  was manually dispatched on the same commit with `failure_probe=true`. The
  public job ran for 15m01s and failed as intended. Its one error annotation
  targets step 8; the pinned workflow defines step 7 as `Run the canonical
  quality gate` and step 8 as `Deliberate failure probe`. The bounded failure
  artifact was uploaded.
- The classic branch-protection rule matches `main`, requires the exact status
  context `Flect quality gate`, requires the branch to be current, applies to
  administrators, and disallows force-pushes and deletion. It does not invent
  an approval requirement that issue #31 did not request.

This completes the observable acceptance criteria owned by issue #31. The
publication head containing this report must still receive its own required
green check before PR #38 can merge.

The first report-head run,
[31437835135](https://github.com/akua-dev/flect/actions/runs/31437835135),
correctly failed rather than being ignored. Its bounded artifact showed 83/85
Chromium flows passing, one warm Fast-4G activation outlier at 1,075 ms against
the unchanged 1,000 ms limit, and an execution diagnostic that started eleven
complete disposable Rifty/QuickJS runtimes with unbounded concurrency. The
diagnostic now caps those independent Effect fibers at two; no performance
budget was relaxed. Ten repeated production-browser executions and ten
Fast/Slow-4G runs then passed locally, with warm Fast-4G activation between 505
and 522 ms. The final required GitHub check remains authoritative for the
publication head.

## Real browser and packaged-host evidence

The current production build was opened through `chrome-devtools-axi`, not a
source-code approximation:

- the view-only document loaded three resources before activation;
- cold local navigation measured LCP 78 ms, TTFB 1 ms, and CLS 0.00;
- Lighthouse passed all 46 applicable audits with 100 for Accessibility, Best
  Practices, SEO, and Agentic Browsing;
- the first workspace action measured INP 25 ms and CLS 0.00;
- only that action loaded the Effect workspace, deferred stylesheet, Git
  worker, and protected UI modules; and
- with the private runtime intentionally absent, the loaded workspace exposed
  an actionable `Runtime offline` state instead of a blank or broken screen.

`bun run test:desktop:local` then passed against an isolated random-ID copy of
the packaged app with an isolated Pi home. The public macOS Accessibility tree
proved native menus, all three native window controls, the 760 × 560 minimum,
an editable first draft, main-window survival after a hard sidecar kill, exact
draft restoration, sidecar relaunch, and single-window ownership. The bundle
was verified with its declared ad-hoc signature; this is deliberately not
reported as Developer ID or notarized distribution.

## External authorities still required

After integration, the implemented issues `#5`, `#8`, `#9`, `#10`, `#11`,
`#12`, `#20`, `#25`, `#27`, `#31`, `#32`, `#33`, `#34`, `#35`, and `#37` can
close with PR and hosted-run evidence. The following nine issues must remain
open until their own acceptance criteria exist:

| Issue | Missing authority or observation |
| ----: | -------------------------------- |
| #1, #17 | Tracking epics depend on the unresolved child gates below. |
| #13 | An independent security reviewer must approve the remote-runtime design before any non-loopback implementation. |
| #19 | The private Pi auth file is mode `0600` but currently empty. `bun run test:pi-smoke` therefore stopped before a provider call with `no authenticated model`; no prompt was sent and no cost was incurred. A real account owner must authorize a provider and complete the clean-profile browser and packaged turn. |
| #21 | Source/browser fault proof and isolated packaged sidecar recovery pass; clean-machine accepted-revision and storage-pressure observation is still external. |
| #22 | Automated WCAG, reflow, appearance, keyboard, and announcement gates pass; the issue explicitly forbids claiming accessibility from automation alone and still requires recorded keyboard-only and macOS VoiceOver walkthroughs. |
| #23 | `security find-identity -v -p codesigning` reports zero valid identities. Developer ID signing, notarization/stapling, Gatekeeper, clean-machine install/update/uninstall, and independent rebuild evidence cannot be fabricated. |
| #28 | The verified public package tarball and three reference products exist, but the public npm registry returns 404 for `@flect/product` and Bun reports no npm authentication. Publishing requires an authorized package owner. |
| #36 | Browser budgets and the isolated packaged AX/native-recovery gate pass; clean supported hardware still needs the issue's trackpad, VoiceOver, visual-appearance, long-session, and real-host trace walkthrough. |

Closing these nine issues without those observations would contradict their
acceptance criteria and Flect's rule that future or externally gated behavior
is never described as implemented.
