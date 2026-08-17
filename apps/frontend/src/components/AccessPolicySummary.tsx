import type { ArtifactDetail } from "contracts";
import { audienceLabel, expiryLabel } from "../lib/formatters";

/** Read-only counterpart to AccessPolicyEditor, shown to viewers who can see the artifact but
 * don't own it (`!artifact.canManagePolicy`) — only the owner may change the policy (03 §1), but
 * anyone who can view it may still want to know who else can. */
export function AccessPolicySummary({ artifact }: { artifact: ArtifactDetail }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-700">Access policy</h2>
      <dl className="mt-3 flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-neutral-500">Audience</dt>
          <dd className="text-neutral-800">{audienceLabel(artifact.audienceType)}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">Expiry</dt>
          <dd className="text-neutral-800">{expiryLabel(artifact)}</dd>
        </div>
      </dl>
    </div>
  );
}
