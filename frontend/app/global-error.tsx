"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: "#000", color: "#fff", fontFamily: "monospace" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#757575", textTransform: "uppercase" }}>
            {"// SYSTEM ERROR"}
          </div>
          <div style={{ fontSize: 13, color: "#F24723", maxWidth: 400, textAlign: "center" }}>
            {error.message || "An unexpected error occurred"}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              onClick={reset}
              style={{ height: 36, padding: "0 20px", fontSize: 11, fontFamily: "monospace", letterSpacing: "0.05em", textTransform: "uppercase", background: "#C0FE04", color: "#000", border: "1px solid #C0FE04", cursor: "pointer" }}
            >
              RETRY
            </button>
            <a
              href="/"
              style={{ height: 36, padding: "0 20px", fontSize: 11, fontFamily: "monospace", letterSpacing: "0.05em", textTransform: "uppercase", background: "transparent", color: "#8A8A8A", border: "1px solid #1C1C1C", cursor: "pointer", display: "inline-flex", alignItems: "center", textDecoration: "none" }}
            >
              HOME
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
