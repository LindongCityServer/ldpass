import { ProviderRedemptionsPanel } from './provider-redemptions-panel';

interface ProviderRedemptionsPageProps {
  searchParams?: Promise<{
    cardNumber?: string;
  }>;
}

export default async function ProviderRedemptionsPage({ searchParams }: ProviderRedemptionsPageProps) {
  const resolvedSearchParams = await searchParams;
  return <ProviderRedemptionsPanel initialCardNumber={resolvedSearchParams?.cardNumber} />;
}
