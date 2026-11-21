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
