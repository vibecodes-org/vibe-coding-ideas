import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <Navbar />
      <ScrollToTop />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <div className="flex-1">{children}</div>
        <Footer />
      </main>
    </div>
  );
}
