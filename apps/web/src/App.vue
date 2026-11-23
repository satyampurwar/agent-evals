<!--
  Root Vue shell: top nav + the active page.

  `<RouterLink>` = client-side navigation (no full page reload).
  `<RouterView>` = placeholder where the matched route component renders
  (see router.ts). Pages under pages/ swap in here.
-->
<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <header class="topbar">
    <strong class="brand">Agent evals</strong>
    <nav>
      <RouterLink to="/experiments">Experiments</RouterLink>
      <RouterLink to="/configs">Configs</RouterLink>
      <RouterLink to="/tasks">Tasks</RouterLink>
    </nav>
  </header>
  <main class="page">
    <RouterView />
  </main>
</template>
