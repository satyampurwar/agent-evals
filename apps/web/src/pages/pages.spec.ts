import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from '../App.vue';
import TasksPage from './TasksPage.vue';
import ConfigsPage from './ConfigsPage.vue';
import ExperimentsPage from './ExperimentsPage.vue';
import ExperimentDetailPage from './ExperimentDetailPage.vue';
import ComparePage from './ComparePage.vue';
import TrialPage from './TrialPage.vue';

/**
 * Server-renders each page's first render through the router. The API is not called (onMounted does
 * not run during SSR), so this catches template and setup errors, not data flow. The click-through
 * drill is the real check for behaviour.
 */
async function render(component: unknown, props: Record<string, unknown> = {}, path = '/') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { render: () => h('div') } },
      { path: '/experiments', name: 'experiments', component: { render: () => h('div') } },
      { path: '/experiments/:id', name: 'experiment', component: { render: () => h('div') } },
      { path: '/experiments/:id/compare', name: 'compare', component: { render: () => h('div') } },
      { path: '/trials/:id', name: 'trial', component: { render: () => h('div') } },
      { path: '/configs', name: 'configs', component: { render: () => h('div') } },
      { path: '/tasks', name: 'tasks', component: { render: () => h('div') } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const app = createSSRApp({ render: () => h(component as never, props) });
  app.use(router);
  return renderToString(app);
}

describe('pages render their first state', () => {
  it('app shell has the three navigation links', async () => {
    const html = await render(App, {}, '/tasks');
    expect(html).toContain('Experiments');
    expect(html).toContain('Configs');
    expect(html).toContain('Tasks');
  });

  it('tasks page', async () => {
    expect(await render(TasksPage)).toContain('Tasks');
  });

  it('configs page shows the form', async () => {
    const html = await render(ConfigsPage);
    expect(html).toContain('New config');
    expect(html).toContain('Save config');
  });

  it('experiments page shows a loading state until its lists arrive', async () => {
    const html = await render(ExperimentsPage);
    expect(html).toContain('Loading');
    expect(html).not.toContain('Create experiment');
  });

  it('experiment detail page waits for data before rendering its body', async () => {
    const html = await render(ExperimentDetailPage, { id: '00000000-0000-4000-8000-000000000000' });
    expect(html).not.toContain('Trials');
  });

  it('compare page shows the back link and the compare control', async () => {
    const html = await render(ComparePage, { id: '00000000-0000-4000-8000-000000000000' });
    expect(html).toContain('Back to experiment');
    expect(html).toContain('Compare');
  });

  it('trial page waits for data before rendering its body', async () => {
    const html = await render(TrialPage, { id: '00000000-0000-4000-8000-000000000000' });
    expect(html).not.toContain('Grader results');
  });
});
