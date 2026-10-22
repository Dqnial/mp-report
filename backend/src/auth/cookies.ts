export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_PATH = '/api/auth/refresh';

export function readCookie(cookies: unknown, name: string): string | undefined {
  const value = (cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : undefined;
}
