"use client";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/create", label: "Create" },
] as const;

interface NavProps {
  activePage: "home" | "create";
}

export default function Nav({ activePage }: NavProps) {
  const activeHref = activePage === "home" ? "/" : "/create";

  return (
    <nav aria-label="Main navigation" className="flex items-center justify-between h-14 px-6 border-b border-b-DEFAULT shrink-0">
      {activePage === "home" ? (
        <span className="font-sans text-subheading font-bold tracking-widest">BABEL</span>
      ) : (
        <a href="/" className="font-sans text-subheading font-bold tracking-widest">BABEL</a>
      )}
      <div className="flex items-center gap-6">
        {LINKS.map((link) =>
          link.href === activeHref ? (
            <span key={link.href} className="text-micro text-primary tracking-widest" aria-current="page">
              {link.label}
            </span>
          ) : (
            <a key={link.href} href={link.href} className="text-micro text-t-muted tracking-widest hover:text-white transition-colors">
              {link.label}
            </a>
          )
        )}
      </div>
    </nav>
  );
}
