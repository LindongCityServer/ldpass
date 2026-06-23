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
        src: '/brand/ldpass_icon_color.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
