import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import Login from '@/views/Login.vue';
import '@/styles/global.css';

const pinia = createPinia();

pinia.use(piniaPluginPersistedstate)

createApp(Login).use(pinia).mount('#app');

