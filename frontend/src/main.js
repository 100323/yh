import { createApp } from 'vue';
import { createPinia } from 'pinia';

import App from './App.vue';
import router from './router';
import './styles/main.scss';
import registerUi, { ensureRouteUi } from './plugins/ui';

const app = createApp(App);

registerUi(app);
router.beforeResolve(async (to) => {
  await ensureRouteUi(to);
});

app.use(createPinia());
app.use(router);

app.mount('#app');
