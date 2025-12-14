import { createApp } from 'vue';
import { createPinia } from 'pinia';

import ChatWidget from '@/views/ChatWidget.vue';
import '@/styles/global.css';

const pinia = createPinia();

createApp(ChatWidget).use(pinia).mount('#app');

