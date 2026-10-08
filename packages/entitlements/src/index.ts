import { type Entitlements, PLAN_ENTITLEMENTS, type PlanId, type Resolution } from "./plans";

export * from "./plans";

const RESOLUTION_RANK: Record<Resolution, number> = { "720p": 0, "1080p": 1, "4k": 2 };

export function entitlementsFor(plan: PlanId): Entitlements {
  return PLAN_ENTITLEMENTS[plan];
}

export const canExportResolution = (e: Entitlements, r: Resolution) =>
  RESOLUTION_RANK[r] <= RESOLUTION_RANK[e.maxResolution];
export const canExport4K = (e: Entitlements) => canExportResolution(e, "4k");
export const canUsePremiumDevice = (e: Entitlements) => e.premiumDevices;
export const canUsePremiumTemplate = (e: Entitlements) => e.premiumTemplates;
export const canCreateShareLink = (e: Entitlements) => e.shareLinks;
export const canSyncProject = (e: Entitlements) => e.cloudSync;
export const canUseTeamWorkspace = (e: Entitlements) => e.teamFeatures;
export const canCreateProject = (e: Entitlements, current: number) =>
  e.maxProjects === null || current < e.maxProjects;
