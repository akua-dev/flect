<script>
// biome-ignore lint/correctness/noUnusedVariables: referenced by the Svelte template
let count = 0;
</script>

<main>
  <h1>Svelte project imported</h1>
  <button type="button" onclick={() => count += 1}>Svelte count {count}</button>
</main>

<style>
  button { border-radius: 0.5rem; }
</style>
