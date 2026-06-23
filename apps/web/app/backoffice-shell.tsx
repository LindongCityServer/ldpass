'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { brandAssets } from '@ldpass/ui';
import { ThemeSettings } from './theme-provider';

const adminNavItems = [
  { href: '/admin', label: '概览', icon: 'space_dashboard' },
  { href: '/admin/users', label: '用户', icon: 'group' },
  { href: '/admin/providers', label: '提供方', icon: 'storefront' },
  { href: '/admin/pass-templates', label: '模板审核', icon: 'approval' },
  { href: '/admin/add-pass-token', label: '领取码', icon: 'qr_code_2' },
  { href: '/admin/passes', label: '卡券', icon: 'cards' },
  { href: '/admin/disputes', label: '争议', icon: 'forum' },
  { href: '/admin/audit', label: '审计', icon: 'receipt_long' },
  { href: '/admin/theme', label: '主题', icon: 'palette' },
  { href: '/admin/platform', label: '平台', icon: 'tune' },
  { href: '/admin/storage', label: '存储', icon: 'hard_drive' },
  { href: '/admin/client-applications', label: '客户端', icon: 'hub' },
  { href: '/admin/card-template-variants', label: '卡面', icon: 'dashboard_customize' },
  { href: '/admin/legal', label: '协议', icon: 'contract' },
];

const providerNavItems = [
  { href: '/provider/dashboard', label: '工作台', icon: 'space_dashboard' },
  { href: '/provider/templates', label: '模板', icon: 'view_carousel' },
  { href: '/provider/issue', label: '发放', icon: 'qr_code_2' },
  { href: '/provider/passes', label: '卡券', icon: 'cards' },
  { href: '/provider/disputes', label: '争议', icon: 'forum' },
  { href: '/provider/api-keys', label: 'API 密钥', icon: 'key' },
  { href: '/provider/webhooks', label: 'Webhook', icon: 'webhook' },
];

interface BackofficeShellProps {
  children: React.ReactNode;
  kind: 'admin' | 'provider';
}

export function BackofficeShell({ children, kind }: BackofficeShellProps) {
  const pathname = usePathname();
  const [isMounted, setIsMounted] = useState(false);
  const isAdmin = kind === 'admin';
  const navItems = isAdmin ? adminNavItems : providerNavItems;
  const title = isAdmin ? '平台管理' : '发卡方后台';
  const homeHref = isAdmin ? '/admin' : '/provider/dashboard';
  const activePathname = isMounted ? pathname : '';

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <main className="backoffice-shell">
      <header className="backoffice-topbar">
        <a className="brand backoffice-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <div className="backoffice-title">
          <span>{title}</span>
          <strong>{readCurrentLabel(activePathname, navItems) ?? '控制台'}</strong>
        </div>
        <div className="backoffice-topbar-actions">
          <a className="secondary-action" href={homeHref}>
            <span className="material-symbols-rounded" aria-hidden="true">
              home
            </span>
            <span>后台首页</span>
          </a>
          <ThemeSettings />
        </div>
      </header>

      <div className="backoffice-body">
        <nav className="backoffice-nav" aria-label={title}>
          {navItems.map((item) => {
            const isActive = isActiveNavItem(activePathname, item.href);
            return (
              <a
                className={isActive ? 'is-active' : undefined}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                key={item.href}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>
        <div className="backoffice-content">{children}</div>
      </div>
    </main>
  );
}

function readCurrentLabel(pathname: string, navItems: typeof adminNavItems): string | null {
  const matchedItem = navItems
    .filter((item) => isActiveNavItem(pathname, item.href))
    .sort((first, second) => second.href.length - first.href.length)[0];

  return matchedItem?.label ?? null;
}

function isActiveNavItem(pathname: string, href: string): boolean {
  if (href === '/admin' || href === '/provider') {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
