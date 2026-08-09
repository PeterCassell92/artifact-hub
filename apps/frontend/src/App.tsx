import { NotificationRegion } from "./components/NotificationRegion";

/**
 * Scaffold shell. Real routes/views (Dashboard, My Artifacts, Shared With Me, artifact
 * detail, admin) are defined in docs/frontend/. NotificationRegion is mounted app-wide so
 * every feature has a compliant way to signal success/error (no toasts/alerts).
 */
export default function App() {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <NotificationRegion />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="text-xl font-semibold">Artifact Hub</h1>
        <p className="mt-2 text-neutral-600">
          Frontend scaffold. Views to be built per <code>docs/frontend/</code>.
        </p>
      </main>
    </div>
  );
}
