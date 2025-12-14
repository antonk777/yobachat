import { createApp } from 'vue';
import { createPinia } from 'pinia';

import AdminPanel from '@/views/AdminPanel.vue';
import '@/styles/global.css';

const pinia = createPinia();

createApp(AdminPanel).use(pinia).mount('#app');
