/**
 * Vue app bootstrap (entry module Vite loads from index.html).
 *
 * Vue 3 in a nutshell: a "component" is a reusable UI unit (template + script).
 * `createApp(Root)` builds the app instance; `.use(plugin)` registers plugins
 * (here: vue-router for client-side URLs); `.mount('#app')` attaches the tree
 * to the empty `<div id="app">` in index.html — after that, Vue owns the DOM.
 *
 * Importing `./style.css` applies global styles. `App.vue` is the shell (nav +
 * `<RouterView />`); pages swap in based on the current route.
 */
import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { router } from './router';

createApp(App).use(router).mount('#app');
