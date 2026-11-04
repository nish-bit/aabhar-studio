"use client";

/** Last-resort error page (the root layout itself failed). Must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#faf7f2", color: "#1f1b16", margin: 0 }}>
        <main style={{ maxWidth: 520, margin: "15vh auto", padding: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 500 }}>Something went wrong</h1>
          <p style={{ color: "#5c544a" }}>
            We couldn&apos;t load this page. Please try again.{error.digest ? ` Reference: ${error.digest}` : ""}
          </p>
          <button onClick={reset} style={{ marginTop: 16, padding: "10px 16px", background: "#1f1b16", color: "#fff", border: 0, borderRadius: 4 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
