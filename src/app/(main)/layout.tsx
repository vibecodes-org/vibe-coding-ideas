import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { ScrollToTop } from "@/components/layout/scroll-to-top";
import { MainFocus } from "@/components/layout/main-focus";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden">
      <Navbar />
      <ScrollToTop />
      <MainFocus />
      {/* tabIndex + MainFocus: <main> is the page's scroll container, and the
          keyboard only scrolls the box around the focused element — so it must
          be focusable, and focused on load, for arrow / Page keys to work
          without first tabbing into the page. Focus ring suppressed: this is
          a scroll region, not a control. */}
      <main
        tabIndex={0}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden outline-none"
      >
        <div className="flex-1">{children}</div>
        <Footer />
      </main>
    </div>
  );
}
