import type { Group } from "@prisma/client";
import type { GroupView } from "contracts";
import { prisma } from "../db";

export function listGroups(): Promise<Group[]> {
  return prisma.group.findMany({ orderBy: { name: "asc" } });
}

export function createGroup(name: string, description?: string): Promise<Group> {
  return prisma.group.create({ data: { name, description } });
}

export function findGroupsByNames(names: string[]): Promise<Group[]> {
  return prisma.group.findMany({ where: { name: { in: names } } });
}

export function findGroupsByIds(ids: string[]): Promise<Group[]> {
  return prisma.group.findMany({ where: { id: { in: ids } } });
}

export function toGroupView(group: Group): GroupView {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    createdAt: group.createdAt.toISOString(),
  };
}
