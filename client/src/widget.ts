import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

import ChatWidget from '@/views/ChatWidget.vue';
import '@/styles/global.css';

const pinia = createPinia();

pinia.use(piniaPluginPersistedstate)

createApp(ChatWidget).use(pinia).mount('#app');

