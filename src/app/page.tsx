import { AuthGate } from "../components/auth/AuthGate";

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  const previewAllowed =
    process.env.NODE_ENV === "development" || process.env.COMPASS_ENABLE_PREVIEW === "1";
  const preview = previewAllowed && params.preview === "1";

  return <AuthGate preview={preview} />;
}
