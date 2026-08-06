import type { SharedConfig } from './shared-types';

/** Pull the public/shared fields from a unified app config object. */
export function pickSharedConfig(raw: unknown): SharedConfig {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof (raw as SharedConfig).host !== 'string' ||
    typeof (raw as SharedConfig).apiHost !== 'string' ||
    typeof (raw as SharedConfig).basePath !== 'string' ||
    typeof (raw as SharedConfig).wsPath !== 'string'
  ) {
    throw new Error('Invalid config: missing or invalid host/apiHost/basePath/wsPath');
  }

  const config = raw as SharedConfig;

  return {
    host: config.host,
    apiHost: config.apiHost,
    basePath: config.basePath,
    wsPath: config.wsPath,
  };
}

export function getClientOrigin(config: SharedConfig): string {
  return `http://${config.host}`;
}

export function getApiOrigin(config: SharedConfig): string {
  return `http://${config.apiHost}`;
}

export function getWsUrl(config: SharedConfig, query = ''): string {
  const base = `ws://${config.apiHost}${config.basePath}${config.wsPath}`;
  return query ? `${base}${query.startsWith('?') ? query : `?${query}`}` : base;
}

export function joinSharedPath(config: SharedConfig, ...segments: string[]): string {
  const base = config.basePath.endsWith('/') ? config.basePath : `${config.basePath}/`;
  const path = segments
    .map(segment => segment.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

  return `${base}${path}`;
}
