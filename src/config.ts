export interface Config {
  databaseUrl: string;
  feedUrls: string[];
  lineChannelAccessToken: string | null;
  adminLineUserId: string | null;
  healthcheckUrl: string | null;
}

const optional = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null);

export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = optional(env.DATABASE_URL);
  const feedUrls = (env.FEED_URLS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const missing: string[] = [];
  if (!databaseUrl) missing.push('DATABASE_URL');
  if (feedUrls.length === 0) missing.push('FEED_URLS');
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')}`);
  return {
    databaseUrl: databaseUrl!,
    feedUrls,
    lineChannelAccessToken: optional(env.LINE_CHANNEL_ACCESS_TOKEN),
    adminLineUserId: optional(env.ADMIN_LINE_USER_ID),
    healthcheckUrl: optional(env.HEALTHCHECK_URL),
  };
}
