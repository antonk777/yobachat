import type { SharedConfig } from './shared-types';

export function isSecureSharedConfig(config: SharedConfig): boolean {
  return config.secure !== false;
}

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
    secure: typeof config.secure === 'boolean' ? config.secure : undefined,
  };
}

export function getClientOrigin(config: SharedConfig): string {
  const protocol = isSecureSharedConfig(config) ? 'https' : 'http';
  return `${protocol}://${config.host}`;
}

export function getApiOrigin(config: SharedConfig): string {
  const protocol = isSecureSharedConfig(config) ? 'https' : 'http';
  return `${protocol}://${config.apiHost}`;
}

export function getWsUrl(config: SharedConfig, query = ''): string {
  const protocol = isSecureSharedConfig(config) ? 'wss' : 'ws';
  const base = `${protocol}://${config.apiHost}${config.basePath}${config.wsPath}`;
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
