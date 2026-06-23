'use client';

import { usePathname } from 'next/navigation';
import { BackofficeShell } from '../backoffice-shell';

export default function ProviderLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  if (pathname === '/provider/login' || pathname === '/provider/register') {
    return children;
  }

  return <BackofficeShell kind="provider">{children}</BackofficeShell>;
}
