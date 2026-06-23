import { WalletHome } from './wallet-home';

interface HomePageProps {
  searchParams?: Promise<{
    category?: string;
    pass?: string;
  }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;

  return <WalletHome initialCategory={resolvedSearchParams?.category} initialPassId={resolvedSearchParams?.pass} />;
}
