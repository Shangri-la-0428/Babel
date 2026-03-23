"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-void">
      <div className="text-micro text-t-dim tracking-widest">{"// ERROR"}</div>
      <div className="text-detail text-danger normal-case tracking-normal max-w-md text-center">
        {error.message || "An error occurred"}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="h-9 px-5 text-micro font-medium tracking-wider bg-primary text-void border border-primary hover:bg-transparent hover:text-primary active:scale-[0.97] transition-[colors,transform]"
        >
          RETRY
        </button>
        <a
          href="/"
          className="h-9 px-5 text-micro font-medium tracking-wider border border-b-DEFAULT text-t-muted hover:border-primary hover:text-primary transition-colors inline-flex items-center"
        >
          HOME
        </a>
      </div>
    </div>
  );
}
