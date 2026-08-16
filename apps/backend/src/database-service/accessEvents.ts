import type { AccessAction, AccessDecision, AccessRoute } from "contracts";
import { prisma } from "../db";
import type { DenyReason } from "../core/authz";

export interface RecordAccessEventInput {
  artifactId: string;
  userId: string;
  route: AccessRoute;
  action: AccessAction;
  decision: AccessDecision;
  denyReason?: DenyReason;
  shareLinkId?: string;
}

/**
 * Writes the artifact-access audit trail (docs/models/access-event.md) — both allowed and
 * denied attempts, so revocation/expiry are provable. Called from every access path (ui /
 * share_link / mcp); Phase 2 only wires the `ui` route.
 */
export async function recordAccessEvent(input: RecordAccessEventInput): Promise<void> {
  await prisma.accessEvent.create({
    data: {
      artifactId: input.artifactId,
      userId: input.userId,
      route: input.route,
      action: input.action,
      decision: input.decision,
      denyReason: input.denyReason,
      shareLinkId: input.shareLinkId,
    },
  });
}
