import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";

const description =
  "VibeCodes press kit — screenshots, positioning statement, platform statistics, tech stack, and media assets for the AI-powered idea board.";

export const metadata = {
  title: "Press Kit",
  description,
  openGraph: {
    title: "Press Kit | VibeCodes",
    description,
    url: "https://vibecodes.co.uk/press",
  },
  twitter: {
    title: "Press Kit | VibeCodes",
    description,
  },
};

export default function PressLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 lg:px-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}
