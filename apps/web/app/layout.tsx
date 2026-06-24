import type { Metadata, Viewport } from 'next';
import { PlatformStatusBanner } from './platform-status-banner';
import { ServiceWorkerRegistration } from './service-worker-registration';
import { SiteLegalFooter } from './site-legal-footer';
import { ThemeScript } from './theme-script';
import './globals.css';

export const metadata: Metadata = {
  title: '临东通',
  description: '临东通卡包管理网站',
  applicationName: '临东通',
  icons: {
    icon: [
      { url: '/brand/ldpass_icon_color.svg', type: 'image/svg+xml' },
      { url: '/brand/ldpass_favicon_32.png', sizes: '32x32', type: 'image/png' },
    ],
    shortcut: [{ url: '/brand/ldpass_favicon_32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/brand/ldpass_apple_touch_icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0,0&display=block"
        />
      </head>
      <body>
        <ServiceWorkerRegistration />
        <PlatformStatusBanner />
        {children}
        <SiteLegalFooter />
      </body>
    </html>
  );
}
