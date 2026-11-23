/**
 * Client-side routes (vue-router).
 *
 * Unlike a traditional multi-page site, this SPA never full-reloads for in-app
 * links. The browser URL still changes (`createWebHistory` = normal paths like
 * `/experiments/…`), but Vue swaps which page component renders inside App.vue's
 * `<RouterView />`.
 *
 * `props: true` passes path params (e.g. `:id`) as component props.
 * The Nest API is separate — routes here are UI only; data comes from `api/`.
 */
import { createRouter, createWebHistory } from 'vue-router';
import TasksPage from './pages/TasksPage.vue';
import ConfigsPage from './pages/ConfigsPage.vue';
import ExperimentsPage from './pages/ExperimentsPage.vue';
import ExperimentDetailPage from './pages/ExperimentDetailPage.vue';
import ComparePage from './pages/ComparePage.vue';
import TrialPage from './pages/TrialPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/experiments' },
    { path: '/tasks', name: 'tasks', component: TasksPage },
    { path: '/configs', name: 'configs', component: ConfigsPage },
    { path: '/experiments', name: 'experiments', component: ExperimentsPage },
    { path: '/experiments/:id', name: 'experiment', component: ExperimentDetailPage, props: true },
    { path: '/experiments/:id/compare', name: 'compare', component: ComparePage, props: true },
    { path: '/trials/:id', name: 'trial', component: TrialPage, props: true },
  ],
});
