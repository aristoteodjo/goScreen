export type PlanId = "free" | "trial" | "pro" | "team" | "enterprise";

export type Resolution = "720p" | "1080p" | "4k";

export type Entitlements = {
  maxProjects: number | null;
  maxResolution: Resolution;
  watermark: boolean;
  cloudSync: boolean;
  shareLinks: boolean;
  premiumDevices: boolean;
  premiumTemplates: boolean;
  teamFeatures: boolean;
};

const PRO: Entitlements = {
  maxProjects: null,
  maxResolution: "4k",
  watermark: false,
  cloudSync: true,
  shareLinks: true,
  premiumDevices: true,
  premiumTemplates: true,
  teamFeatures: false,
};

// The only place that maps plans to rights. Everything else asks `can*`.
export const PLAN_ENTITLEMENTS: Record<PlanId, Entitlements> = {
  free: {
    maxProjects: 3,
    maxResolution: "720p",
    watermark: true,
    cloudSync: false,
    shareLinks: false,
    premiumDevices: false,
    premiumTemplates: false,
    teamFeatures: false,
  },
  trial: PRO,
  pro: PRO,
  team: { ...PRO, teamFeatures: true },
  enterprise: { ...PRO, teamFeatures: true },
};

export const PLAN_LABELS: Record<PlanId, string> = {
  free: "Free",
  trial: "Pro trial",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
};
