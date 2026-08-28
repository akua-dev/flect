// Dynamic-import chunk-naming seam, not a backward-compatibility re-export.
//
// activate-flect.ts's eager activation bootstrap does `import('./workspace-activation')`
// to defer loading the protected workspace coordinator until explicit user
// intent (see docs/decisions/0003-astro-activation-shell.md). Rolldown/Vite
// names the resulting split chunk after the entry module of a dynamic
// import - this file exists only to pin that chunk's name to the stable,
// semantically-meaningful "workspace-activation" rather than whatever the
// real implementation module happens to be called. scripts/check-browser-bundle.ts
// asserts the eager bundle's compiled `import()` call literally references
// `assets/workspace-activation.<hash>.js` as proof the workspace coordinator
// was split into its own deferred chunk and never inlined into the view-only
// bundle. If the real implementation module is ever renamed, keep this
// file's name and its re-export target in sync - do not delete it.
export { activateWorkspace } from './workspace-activation-runtime';
