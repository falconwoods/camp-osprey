import { cache } from 'react';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export const requireSession = cache(async () => {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  return session;
});
