'use client';

import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

type ReturnToCampsoonButtonProps = {
  className?: string;
  icon?: ReactNode;
};

export function ReturnToCampsoonButton({
  className = 'inline-flex h-[58px] w-full max-w-[310px] items-center justify-center gap-3 rounded-full bg-[#07934f] px-8 text-xl font-extrabold tracking-normal text-white shadow-[0_16px_34px_rgba(7,147,79,0.28)] transition hover:bg-[#078047] focus:outline-none focus:ring-2 focus:ring-[#07934f] focus:ring-offset-2',
  icon = <ExternalLink className="h-6 w-6" aria-hidden="true" />,
}: ReturnToCampsoonButtonProps) {
  return (
    <button
      className={className}
      type="button"
      onClick={() => window.close()}
    >
      {icon}
      Return to Campsoon
    </button>
  );
}
