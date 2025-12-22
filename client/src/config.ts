import { SharedConfig } from "@shared/shared-types";

export const kMaxMessages = 60;

function loadSharedConfig(): SharedConfig {
  // Vite's define will replace this at build time with the actual config object
  // @ts-ignore - __SHARED_CONFIG__ is injected at build time by Vite's define
  const configValue = __SHARED_CONFIG__;

  if (!configValue) {
    throw new Error(
      'Shared config is not available. Ensure SHARED_CONFIG is defined at build time. ' +
      'This should be set automatically by vite.config.ts when loading the shared config file.'
    );
  }

  if (
    typeof configValue !== 'object' ||
    typeof configValue.host !== 'string' ||
    typeof configValue.apiHost !== 'string' ||
    typeof configValue.basePath !== 'string' ||
    typeof configValue.wsPath !== 'string'
  ) {
    throw new Error(
      'Shared config is not valid. Ensure SHARED_CONFIG is defined at build time. ' +
      'This should be set automatically by vite.config.ts when loading the shared config file.'
    );
  }

  return configValue;
}

export const kSharedConfig = loadSharedConfig();