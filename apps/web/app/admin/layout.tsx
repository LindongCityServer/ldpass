'use client';

import { usePathname } from 'next/navigation';
import { BackofficeShell } from '../backoffice-shell';

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  if (pathname === '/admin/login') {
    return children;
  }

  return <BackofficeShell kind="admin">{children}</BackofficeShell>;
}
