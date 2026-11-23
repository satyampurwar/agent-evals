/**
 * Vue entry (loaded from index.html).
 * Mounts `App.vue` with the router onto `#app`. Global styles: `./style.css`.
 */
import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { router } from './router';

createApp(App).use(router).mount('#app');
