import type { Invitation, User } from "@prisma/client";
import type { Role } from "contracts";
import { prisma } from "../db";
import { generateToken, hashToken } from "../core/secureTokens";
import { enqueueOutboxEvent } from "./outbox";

const EXPIRES_IN_DAYS = 7;

export type InvitationWithInviter = Invitation & { invitedBy: { name: string | null } };

export interface CreateInvitationParams {
  email: string;
  role: Role;
  groupIds: string[];
  invitedById: string;
}

export interface CreatedInvitation {
  invitation: InvitationWithInviter;
  token: string;
}

/**
 * Creates the invitation and enqueues its "invitation.send" outbox row in one transaction
 * (docs/architecture/02 §6). Draining the outbox (the actual Resend call) is Phase 5 — until
 * then the raw token lives only in the outbox payload, never in this function's caller-visible
 * response beyond the raw `token` returned here (never persisted itself; only its hash is).
 */
export async function createInvitation(params: CreateInvitationParams): Promise<CreatedInvitation> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.create({
      data: {
        email: params.email,
        role: params.role,
        groupIds: params.groupIds,
        tokenHash: hashToken(token),
        invitedById: params.invitedById,
        expiresAt,
      },
      include: { invitedBy: { select: { name: true } } },
    });
    await enqueueOutboxEvent(
      {
        type: "invitation.send",
        payload: { invitationId: inv.id, email: inv.email, role: inv.role, token },
        idempotencyKey: `invitation:${inv.id}`,
      },
      tx,
    );
    return inv;
  });

  return { invitation, token };
}

export function listInvitations(): Promise<InvitationWithInviter[]> {
  return prisma.invitation.findMany({
    orderBy: { createdAt: "desc" },
    include: { invitedBy: { select: { name: true } } },
  });
}

export function findInvitationByToken(token: string): Promise<Invitation | null> {
  return prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
}

export function isInvitationUsable(invitation: Invitation, now: Date): boolean {
  return invitation.status === "pending" && now < invitation.expiresAt;
}

/**
 * Provisions the account (docs/architecture/02 §4): upserts the `users` row (idempotent against
 * a pre-seeded row, e.g. INITIAL_ADMIN_EMAILS), assigns the invited groups (immutable thereafter
 * — there is no self-service group-change route), marks the invitation accepted, and enqueues the
 * Auth0 provisioning outbox row in the same transaction (02 §6) — the actual Management API call
 * (and linking its `user_id` as our `idpSub`) happens asynchronously, see
 * workers/handlers/auth0ProvisionUser.ts.
 */
export async function acceptInvitation(invitation: Invitation): Promise<User> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email: invitation.email },
      update: { role: invitation.role, status: "active" },
      create: { email: invitation.email, role: invitation.role, status: "active" },
    });

    for (const groupId of invitation.groupIds) {
      await tx.groupMembership.upsert({
        where: { userId_groupId: { userId: user.id, groupId } },
        update: {},
        create: { userId: user.id, groupId },
      });
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "accepted", acceptedAt: new Date() },
    });

    await enqueueOutboxEvent(
      {
        type: "auth0.provision_user",
        payload: { userId: user.id, email: user.email },
        idempotencyKey: `auth0-provision:${invitation.id}`,
      },
      tx,
    );

    return user;
  });
}
