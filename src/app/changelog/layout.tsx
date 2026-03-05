import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";

const description =
  "Stay up to date with VibeCodes releases — new features, improvements, and bug fixes across the AI-powered idea board platform.";

export const metadata = {
  title: "Changelog",
  description,
  openGraph: {
    title: "Changelog | VibeCodes",
    description,
    url: "https://vibecodes.co.uk/changelog",
  },
  twitter: {
    title: "Changelog | VibeCodes",
    description,
  },
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
};

export default function ChangelogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}
