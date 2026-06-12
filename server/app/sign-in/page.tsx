import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { SignInForm } from './_components/SignInForm';

function safeNextPath(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/admin';
  return next;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);
  const session = await getSession();
  if (session?.user.role === 'admin') redirect(nextPath);

  return <SignInForm nextPath={nextPath} />;
}
