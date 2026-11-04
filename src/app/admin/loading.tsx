/** Streaming placeholder for admin pages (each page reads per-request data). */
export default function AdminLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="h-9 w-64 animate-pulse rounded-sm bg-surface-sunken" />
      <div className="h-24 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-72 animate-pulse rounded-md bg-surface-sunken" />
    </div>
  );
}
