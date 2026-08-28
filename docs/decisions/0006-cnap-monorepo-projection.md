# ADR 0006: Flect's canonical history moves into cnap; the public repo becomes a projection

- **Status:** Accepted and implemented
- **Date:** 2026-08-28

## Context

Flect was a fully standalone public GitHub repository: contributors pushed
directly, branch protection required its own GitHub Actions workflow, and
commit signatures verified normally. Akua's private `cnap` monorepo is
converging on a Bazel graph, shared rules, and atomic cross-cutting changes
across its products (cnap#772). Moving Flect's development under that roof
means the public repository can no longer be an independently pushed-to git
history without either duplicating work in two places or losing the
monorepo's guarantees.

cnap#866 designed, and cnap#869 executed, a migration: Flect's complete
history was grafted into cnap at `apps/flect/` (preserving every original
commit SHA, verified by round-tripping the graft through
[josh](https://github.com/josh-project/josh)'s path filter), and the public
`akua-dev/flect` repository became a filtered projection of that subtree
instead of an independent repository. The cutover completed 2026-08-28: public
`main` fast-forwarded onto the projection of cnap `main`, with no force-push
and no history rewritten.

## Decision

cnap `main` is canonical for Flect. The public repository is always exactly
`josh-filter ':/apps/flect'` of some cnap commit and never advances ahead of
cnap; the filter string is frozen API and is never changed to fix a content
problem (a filter change would rewrite all projected history).

- **Outbound sync** (cnap → public) is a stateless, idempotent projection:
  `packages/cli/src/commands/delivery/flect-sync.ts`, run via
  `task delivery:flect-sync` (dry-run by default, `--execute` to push). It
  scans the projected range with gitleaks before every push, refuses to push
  on divergence rather than force-pushing, and never routes release tags
  through josh (josh converts annotated tags to plain refs; the sync identity
  tags the projected SHA on the public repo directly). Until the automated
  post-merge Argo step lands, a maintainer runs this by hand after every cnap
  `main` merge that touches `apps/flect/`.
- **Public `main` is branch-protected by push restriction**, not by a
  required status check: only the sync identity may push, and only by
  fast-forward; force-push and deletion are disabled. No outside contributor
  or maintainer pushes to it directly.
- **Inbound contributions** go through a maintainer-triggered import: a
  maintainer reverse-applies an outside PR's commits onto `apps/flect/` in
  cnap and opens a cnap PR from them, which runs cnap's authoritative
  Bazel-driven CI before anything reaches public history. This keeps the
  invariant that public `main` is always exactly a projection of an
  already-cnap-approved commit, with no window where the two diverge. This
  import step has no dedicated tooling yet; it is manual today.
- **The public repository still runs a full advisory GitHub Actions
  workflow** (`quality.yml`, named "Flect quality (advisory)"), running
  Flect's complete `bun run check` suite plus Playwright and Rust/Tauri
  checks on GitHub-hosted runners with `permissions: contents: read` and no
  secrets, for every public pull request and push. It gives contributors fast
  real signal; it is not the authoritative gate.
- **`apps/flect` stays a self-contained Bazel module**: its own
  `MODULE.bazel` declares dependencies only on public Bazel Central Registry
  modules, never on internal cnap targets. Files inside `apps/flect` must
  never reference `//`-labels outside the subtree - inward references from
  the rest of cnap into `//apps/flect/...` are unrestricted, but outward
  references are forbidden, because josh performs no label rewriting and a
  leaked internal reference would ship as an unbuildable label in the public
  projection.

## Consequences

- **Signature badge tradeoff.** Commits authored inside cnap are GPG-signed
  there. A commit that touches `apps/flect/` as part of a larger cnap commit
  becomes a *different* commit object once filtered down to just that
  subtree (different tree, different parent chain), so the original
  signature bytes no longer validate against it. Josh preserves those
  now-invalid `gpgsig` bytes on the rewritten commit by design rather than
  stripping them - stripping would change the commit's content and break the
  SHA identity the whole sync model depends on (including recognizing an
  imported contributor's commit as "merged" once it reprojects). The
  consequence, accepted deliberately: every post-graft cnap-authored commit
  shows GitHub's "Unverified" badge on the public repo. `CONTRIBUTING.md`
  carries a short note explaining why. `gpgsig=remove` and "require signed
  commits" on the public repo both stay forbidden.
- **Advisory-vs-authoritative CI split.** Public contributors get real,
  substantial CI feedback within minutes, on the same test suite Flect always
  ran, at near-zero marginal risk (read-only checkout, no secrets, no
  self-hosted runners, and public `main`'s branch protection carries no
  required status check for it to satisfy). But that result cannot gate or
  approve a merge on the public repo by construction: only the sync identity
  can push to public `main`. The authoritative result comes from cnap's
  Bazel-driven CI on the imported cnap PR, reported back to the public PR by
  the importer.
- **Standalone-projection invariant.** Because `apps/flect` depends on
  nothing outside itself at the Bazel level, the public projection stays
  buildable on its own with no internal cnap context. This is upheld today by
  the self-contained module's construction (verifiable by inspecting
  `apps/flect/MODULE.bazel`); a dedicated lint that rejects an outward label
  before it merges is not yet built.
- **Manual steps remain in the loop.** Outbound sync and the entire inbound
  import flow are maintainer-run today, not automated. A cnap merge touching
  `apps/flect/` does not appear on the public repo until someone runs the
  sync task, and an outside PR does not reach cnap CI until a maintainer
  decides to import it.
- Flect's existing local verification (`bun run check`, `bun run check:all`)
  and its Bazel targets under `apps/flect` (`bazel test //:all` and its three
  `manual`-tagged known-issue targets, see `apps/flect/BUILD.bazel`) are
  unaffected by any of the above; they remain the same commands whether run
  inside cnap or against a standalone checkout of the projection.
