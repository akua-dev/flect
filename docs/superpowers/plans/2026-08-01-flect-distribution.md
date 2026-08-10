# Flect trusted distribution implementation plan

Date: 2026-08-01
Design: `docs/superpowers/specs/2026-08-01-flect-distribution-design.md`

## 1. Make trust policy executable

- [x] Add failing tests for architecture and development/public trust evidence.
- [x] Fail public mode on dirty/untagged source, unverified reproducibility, non-Developer-ID signing,
  missing Team ID, absent hardened runtime, Gatekeeper rejection, or missing
  stapling.
- [x] Stop hard-coding the ad-hoc signing identity in Tauri configuration.

## 2. Generate exact release evidence

- [x] Capture bounded command output and exact toolchain/source facts.
- [x] Hash release inputs and final artifacts.
- [x] Normalize a copied app by removing signatures and hash its sorted content
  tree.
- [x] Write the deterministic release evidence manifest.

## 3. Verify the staged release

- [x] Verify the checksum from the correct directory.
- [x] Gate both embedded executables as arm64 and reject companions.
- [x] Record deep/strict signing, Gatekeeper, and stapling observations.
- [x] Require the manifest alongside the DMG, checksum, and demo.

## 4. Dogfood and reconcile

- [x] Run focused release tests and the local packaging command.
- [x] Rebuild twice, identify Tauri Isolation Pattern randomness, record the
  mismatch honestly, and fail public reproducibility proof closed.
- [x] Mount the final DMG, launch only one current Flect instance, and inspect
  the installed public/private executable path.
- [x] Update README/contributor boundaries, verification evidence, baseline,
  and issue #23 without claiming credential-bound public proof.
