import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import {
  GuideSidebar,
  GuideMobileNav,
  GuideBreadcrumbs,
  GuidePrevNext,
} from "@/components/guide/guide-nav";

export const metadata = {
  title: "Guide",
  description:
    "Learn how to use VibeCodes — share ideas, collaborate with developers, manage projects with kanban boards, and integrate with Claude Code via MCP.",
};

export default function GuideLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="mx-auto flex max-w-5xl gap-8 px-4 py-12 sm:px-6 lg:px-8">
        <GuideSidebar />
        <main className="min-w-0 flex-1">
          <GuideMobileNav />
          <GuideBreadcrumbs />
          {children}
          <GuidePrevNext />
        </main>
      </div>
      <Footer />
    </div>
  );
}
