export const brandAssets = {
  colorLogo: '/brand/ldpass_icon_color.svg',
  monoLogo: '/brand/ldpass_icon.svg',
  promotionalBackground: '/brand/ldpass_background_01.svg',
} as const;

export const passCardAspectRatio = '856 / 540';

export const passTemplateVariantKeys = [
  'account_minimal',
  'account_balance',
  'points_member',
  'times_punch',
  'identity_key',
  'ticket_event',
] as const;

export type PassTemplateVariantKey = (typeof passTemplateVariantKeys)[number];
