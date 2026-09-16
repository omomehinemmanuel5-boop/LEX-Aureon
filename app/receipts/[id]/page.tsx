import { redirect } from 'next/navigation';

export default async function ReceiptCompatibilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/audit/${encodeURIComponent(id)}`);
}
