/// <reference types="vite/client" />

import type { SharedConfig } from '@shared/shared-types';

declare const __SHARED_CONFIG__: SharedConfig;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module '*.svg' {
  const content: string;
  export default content;
}
