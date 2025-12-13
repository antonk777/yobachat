import { createRouter, createWebHistory } from 'vue-router';

import ChatWidget from '@/views/ChatWidget.vue';
import AdminPanel from '@/views/AdminPanel.vue';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/widget'
    },
    {
      path: '/panel',
      name: 'admin',
      component: AdminPanel
    },
    {
      path: '/widget',
      name: 'widget',
      component: ChatWidget
    }
  ]
});

export default router;
