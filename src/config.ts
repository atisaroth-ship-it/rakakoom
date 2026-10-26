export interface Config {
  databaseUrl: string;
  feedUrls: string[];
  lineChannelAccessToken: string | null;
  adminLineUserId: string | null;
  healthcheckUrl: string | null;
  /** Storage limit of the database plan (Neon free: 1 GB per project). */
  dbSizeLimitBytes: number;
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
    dbSizeLimitBytes: Number(optional(env.DB_SIZE_LIMIT_MB) ?? 1024) * 1024 * 1024,
  };
}

/**
 * In production every alert path must be wired: the heartbeat is the only thing that notices a dead machine,
 * and LINE is how the owner hears about a failed day.
 */
export function assertAlertsConfigured(c: Config): void {
  const missing: string[] = [];
  if (!c.lineChannelAccessToken) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
  if (!c.adminLineUserId) missing.push('ADMIN_LINE_USER_ID');
  if (!c.healthcheckUrl) missing.push('HEALTHCHECK_URL');
  if (missing.length) throw new Error(`alerts not configured, missing: ${missing.join(', ')} (set ALLOW_NO_ALERTS=1 only for local testing)`);
}
