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
