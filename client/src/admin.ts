import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import AdminPanel from '@/views/AdminPanel.vue';
import '@/styles/global.css';

const pinia = createPinia();

pinia.use(piniaPluginPersistedstate)

createApp(AdminPanel).use(pinia).mount('#app');
