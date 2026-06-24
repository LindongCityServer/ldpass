'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { brandAssets } from '@ldpass/ui';
import { postJson } from './api-client';
import { ThemeSettings } from './theme-provider';

const adminNavItems = [
  { href: '/admin', label: '概览', icon: 'space_dashboard' },
  { href: '/admin/users', label: '用户', icon: 'group' },
  { href: '/admin/providers', label: '发卡方', icon: 'storefront' },
  { href: '/admin/pass-templates', label: '卡面模板', icon: 'approval' },
  { href: '/admin/card-template-variants', label: '模板变体', icon: 'dashboard_customize' },
  { href: '/admin/add-pass-token', label: '领取码', icon: 'qr_code_2' },
  { href: '/admin/passes', label: '卡券列表', icon: 'cards' },
  { href: '/admin/client-applications', label: '客户端接入', icon: 'hub' },
  { href: '/admin/disputes', label: '争议审核', icon: 'forum' },
  { href: '/admin/audit', label: '审计日志', icon: 'receipt_long' },
  { href: '/admin/platform', label: '平台状态', icon: 'tune' },
  { href: '/admin/legal', label: '协议', icon: 'contract' },
  { href: '/admin/storage', label: '存储情况', icon: 'hard_drive' },
];

const providerNavItems = [
  { href: '/provider/dashboard', label: '工作台', icon: 'space_dashboard' },
  { href: '/provider/templates', label: '模板', icon: 'view_carousel' },
  { href: '/provider/issue', label: '发放', icon: 'qr_code_2' },
  { href: '/provider/redemptions', label: '核销', icon: 'point_of_sale' },
  { href: '/provider/passes', label: '卡券', icon: 'cards' },
  { href: '/provider/disputes', label: '争议', icon: 'forum' },
  { href: '/provider/api-keys', label: 'API 密钥', icon: 'key' },
  { href: '/provider/webhooks', label: 'Webhook', icon: 'webhook' },
];

const adminNavGroups = [
  { label: '身份', items: adminNavItems.slice(1, 3) },
  { label: '卡券', items: adminNavItems.slice(3, 8) },
  { label: '治理', items: adminNavItems.slice(8, 10) },
  { label: '平台', items: adminNavItems.slice(10) },
];

const providerNavGroups = [
  { label: '业务', items: providerNavItems.slice(1, 5) },
  { label: '接入', items: providerNavItems.slice(5) },
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
  const navGroups = isAdmin ? adminNavGroups : providerNavGroups;
  const title = isAdmin ? '平台管理' : '发卡方后台';
  const homeHref = isAdmin ? '/admin' : '/provider/dashboard';
  const activePathname = isMounted ? pathname : '';
  const currentLabel = readCurrentLabel(activePathname, navItems) ?? '控制台';
  const isHomePage = activePathname === homeHref;
  const isSubpage = isMounted && !isHomePage;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const logoutProvider = async () => {
    await postJson('/api/providers/auth/logout');
    window.location.href = '/provider/login';
  };

  return (
    <main className={`backoffice-shell backoffice-shell-${kind}`}>
      <header className={`backoffice-topbar${isSubpage ? ' is-subpage' : ''}`}>
        {isSubpage ? (
          <a className="backoffice-topbar-back" href={homeHref} aria-label={`返回${title}`}>
            <span className="material-symbols-rounded" aria-hidden="true">
              arrow_back
            </span>
          </a>
        ) : null}
        <a className="brand backoffice-brand" href="/" aria-label="返回钱包">
          <img src={brandAssets.colorLogo} alt="" width={36} height={36} />
          <span>临东通</span>
        </a>
        <div className="backoffice-title">
          <span>{title}</span>
          <strong>{currentLabel}</strong>
        </div>
        <div className="backoffice-topbar-actions">
          <a className="secondary-action backoffice-home-action" href={homeHref}>
            <span className="material-symbols-rounded" aria-hidden="true">
              home
            </span>
            <span>后台首页</span>
          </a>
          {!isAdmin ? (
            <button className="secondary-action" type="button" onClick={() => void logoutProvider()}>
              <span className="material-symbols-rounded" aria-hidden="true">
                logout
              </span>
              <span>退出</span>
            </button>
          ) : null}
          <ThemeSettings />
        </div>
      </header>

      <div className={`backoffice-body${isHomePage ? ' is-home' : ''}`}>
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
        {isHomePage ? (
          <nav className="backoffice-mobile-nav" aria-label={`${title}移动导航`}>
            {navGroups.map((group) => (
              <section className="backoffice-mobile-nav-group" key={group.label}>
                <h2>{group.label}</h2>
                <div>
                  {group.items.map((item) => {
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
                </div>
              </section>
            ))}
          </nav>
        ) : null}
        <div className="backoffice-content">{children}</div>
      </div>
    </main>
  );
}

function readCurrentLabel(pathname: string, navItems: typeof adminNavItems | typeof providerNavItems): string | null {
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
