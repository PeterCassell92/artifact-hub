import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

export interface RecordAdminAuditLogInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Administrative-action audit trail (docs/models/system.md) — distinct from AccessEvent, which
 * covers artifact reads. Actions used so far: invite.create, invitation.accept, role.change,
 * user.group_change, user.disable, policy.update, policy.revoke, share_link.create.
 */
export async function recordAdminAuditLog(input: RecordAdminAuditLogInput): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
