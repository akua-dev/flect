<script setup lang="ts">
import { ref } from "vue";

// biome-ignore lint/correctness/noUnusedVariables: referenced by the Vue template
const count = ref(0);
</script>

<template>
  <main>
    <h1>Vue project imported</h1>
    <button type="button" @click="count += 1">Vue count {{ count }}</button>
  </main>
</template>

<style scoped>
button { border-radius: 0.5rem; }
</style>
