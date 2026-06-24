import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '临东通',
    short_name: '临东通',
    description: '临东通卡包管理网站',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      {
        src: '/brand/ldpass_app_icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: '/brand/ldpass_app_icon_192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/brand/ldpass_app_icon_512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
