import { redirect } from "next/navigation";

/** /app has no page of its own; the dashboard is home. */
export default function AppHome() {
  redirect("/app/dashboard");
}
