// The popped-out terminal window's OWN minimal layout — no navbar, no footer,
// no board chrome (unlike `(main)/layout.tsx`, this route sits outside that
// group entirely). Root layout (src/app/layout.tsx) still provides
// html/body/fonts/theme, which is all this window needs on top.

export default function TerminalPopoutLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen w-screen overflow-hidden bg-[#0a0a0b] text-zinc-200">{children}</div>;
}
