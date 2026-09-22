export type FinancialHealth = 'no_data' | 'green' | 'amber' | 'red' | 'critical';
export type ValueStatus = 'actual' | 'estimated' | 'projected';

export interface AdRuleSettings {
  feedIntervalMin: number;
  feedIntervalMax: number;
  minimumMonetizedVideoSeconds: number;
  preRollEnabled: boolean;
  midRollEnabled: boolean;
  firstMidRollSeconds: number;
  maxAdsPerSession: number;
  maxAdsPerUserPerDay: number;
  cooldownSeconds: number;
  creatorRevenueSharePercent: number;
}

export const DEFAULT_AD_RULES: AdRuleSettings = {
  feedIntervalMin: 5,
  feedIntervalMax: 7,
  minimumMonetizedVideoSeconds: 60,
  preRollEnabled: true,
  midRollEnabled: true,
  firstMidRollSeconds: 180,
  maxAdsPerSession: 8,
  maxAdsPerUserPerDay: 20,
  cooldownSeconds: 180,
  creatorRevenueSharePercent: 45,
};

const finite = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const nonNegative = (value: unknown) => Math.max(0, finite(value));
const percentage = (value: unknown) => Math.min(100, nonNegative(value));
const round = (value: number, places = 2) => Number(value.toFixed(places));

export function videoAdSchedule(durationSeconds: number, partial: Partial<AdRuleSettings> = {}) {
  const rules = { ...DEFAULT_AD_RULES, ...partial };
  const duration = nonNegative(durationSeconds);
  if (duration < rules.minimumMonetizedVideoSeconds) return [] as { placement: 'pre_roll' | 'mid_roll'; atSeconds: number }[];

  const opportunities: { placement: 'pre_roll' | 'mid_roll'; atSeconds: number }[] = [];
  if (rules.preRollEnabled) opportunities.push({ placement: 'pre_roll', atSeconds: 0 });
  if (!rules.midRollEnabled || duration < 180) return opportunities.slice(0, rules.maxAdsPerSession);

  const interval = duration < 300 ? duration : duration < 480 ? 210 : duration < 900 ? 270 : 300;
  let at = duration < 300
    ? Math.min(Math.max(150, rules.firstMidRollSeconds), Math.max(150, duration - 30))
    : Math.max(180, rules.firstMidRollSeconds);
  while (at <= duration - 30 && opportunities.length < rules.maxAdsPerSession) {
    opportunities.push({ placement: 'mid_roll', atSeconds: Math.round(at) });
    if (duration < 300) break;
    at += interval;
  }
  return opportunities;
}

export interface FinancialHealthInput {
  totalRevenue: number;
  directPlatformCost: number;
  creatorPayoutLiability: number;
  creatorPayoutSafeLimit?: number | null;
  revenuePerUserChangePercent?: number | null;
  costPerUserChangePercent?: number | null;
  infrastructureBurnChangePercent?: number | null;
}

export function calculateFinancialHealth(input: FinancialHealthInput) {
  const revenue = nonNegative(input.totalRevenue);
  const platformCost = nonNegative(input.directPlatformCost);
  const creatorPayout = nonNegative(input.creatorPayoutLiability);
  const totalDirectCost = platformCost + creatorPayout;
  const contribution = revenue - totalDirectCost;
  const marginPercent = revenue > 0 ? contribution / revenue * 100 : totalDirectCost > 0 ? -100 : 0;
  const revenueCostRatio = totalDirectCost > 0 ? revenue / totalDirectCost : revenue > 0 ? Number.POSITIVE_INFINITY : 0;
  const reasons: string[] = [];

  if (revenue === 0 && totalDirectCost === 0) {
    return { status: 'no_data' as FinancialHealth, revenue, totalDirectCost, contribution, marginPercent: 0, revenueCostRatio: 0, reasons: ['No financial entries have been recorded for this period.'] };
  }

  const payoutLimit = input.creatorPayoutSafeLimit == null ? null : nonNegative(input.creatorPayoutSafeLimit);
  const burnChange = finite(input.infrastructureBurnChangePercent, 0);
  const revenueUserChange = finite(input.revenuePerUserChangePercent, 0);
  const costUserChange = finite(input.costPerUserChangePercent, 0);
  let status: FinancialHealth = 'green';

  if (revenue < totalDirectCost) reasons.push('Revenue is below direct variable cost.');
  if (payoutLimit != null && creatorPayout > payoutLimit) reasons.push('Creator payout liability exceeds its safe limit.');
  if (burnChange >= 50) reasons.push('Infrastructure burn is accelerating sharply.');
  if (reasons.length) status = 'critical';
  else if (revenueCostRatio < 1.2 || marginPercent < 20 || costUserChange > revenueUserChange) {
    status = 'red';
    if (revenueCostRatio < 1.2) reasons.push('Revenue is below 1.2 times direct variable cost.');
    if (marginPercent < 20) reasons.push('Gross margin is below 20%.');
    if (costUserChange > revenueUserChange) reasons.push('Cost per user is rising faster than revenue per user.');
  } else if (revenueCostRatio < 1.5 || marginPercent < 40) {
    status = 'amber';
    if (revenueCostRatio < 1.5) reasons.push('Revenue is below 1.5 times direct variable cost.');
    if (marginPercent < 40) reasons.push('Gross margin is below 40%.');
  } else {
    reasons.push('Revenue covers at least 1.5 times direct variable cost and gross margin is at least 40%.');
  }

  return {
    status,
    revenue: round(revenue),
    totalDirectCost: round(totalDirectCost),
    contribution: round(contribution),
    marginPercent: round(marginPercent),
    revenueCostRatio: Number.isFinite(revenueCostRatio) ? round(revenueCostRatio) : null,
    reasons,
  };
}

export interface SimulatorInput {
  mau: number;
  dailyActivePercent: number;
  minutesPerActiveUserDay: number;
  videosPerActiveUserDay: number;
  videosPerAdOpportunity: number;
  fillRatePercent: number;
  eCpmAud: number;
  creatorPayoutPercent: number;
  subscriptionConversionPercent: number;
  subscriptionPriceAud: number;
  infrastructureCostPerMauAud: number;
  aiCostPerMauAud: number;
  videoDeliveryCostPerMinuteAud: number;
  fixedMonthlyCostAud?: number;
}

export function simulateEconomics(input: SimulatorInput) {
  const mau = nonNegative(input.mau);
  const activeShare = percentage(input.dailyActivePercent) / 100;
  const activeUserDays = mau * activeShare * 30;
  const monthlyWatchMinutes = activeUserDays * nonNegative(input.minutesPerActiveUserDay);
  const monthlyVideoViews = activeUserDays * nonNegative(input.videosPerActiveUserDay);
  const frequency = Math.max(1, nonNegative(input.videosPerAdOpportunity));
  const adOpportunities = monthlyVideoViews / frequency;
  const paidImpressions = adOpportunities * percentage(input.fillRatePercent) / 100;
  const adRevenue = paidImpressions / 1000 * nonNegative(input.eCpmAud);
  const subscriptionRevenue = mau * percentage(input.subscriptionConversionPercent) / 100 * nonNegative(input.subscriptionPriceAud);
  const totalRevenue = adRevenue + subscriptionRevenue;
  const creatorPayout = adRevenue * percentage(input.creatorPayoutPercent) / 100;
  const variablePlatformCost = mau * (nonNegative(input.infrastructureCostPerMauAud) + nonNegative(input.aiCostPerMauAud)) + monthlyWatchMinutes * nonNegative(input.videoDeliveryCostPerMinuteAud);
  const fixedMonthlyCost = nonNegative(input.fixedMonthlyCostAud);
  const platformCost = variablePlatformCost + fixedMonthlyCost;
  const contribution = totalRevenue - creatorPayout - platformCost;
  const marginPercent = totalRevenue > 0 ? contribution / totalRevenue * 100 : 0;
  const contributionPerMauBeforeFixed = mau > 0 ? (totalRevenue - creatorPayout - variablePlatformCost) / mau : 0;
  const breakEvenMau = fixedMonthlyCost > 0 && contributionPerMauBeforeFixed > 0 ? fixedMonthlyCost / contributionPerMauBeforeFixed : null;

  return {
    mau: round(mau, 0),
    monthlyWatchMinutes: round(monthlyWatchMinutes, 0),
    monthlyVideoViews: round(monthlyVideoViews, 0),
    adOpportunities: round(adOpportunities, 0),
    paidImpressions: round(paidImpressions, 0),
    adRevenueAud: round(adRevenue),
    subscriptionRevenueAud: round(subscriptionRevenue),
    totalRevenueAud: round(totalRevenue),
    creatorPayoutAud: round(creatorPayout),
    platformCostAud: round(platformCost),
    contributionAud: round(contribution),
    marginPercent: round(marginPercent),
    revenuePerMauAud: mau > 0 ? round(totalRevenue / mau, 4) : 0,
    costPerMauAud: mau > 0 ? round((creatorPayout + platformCost) / mau, 4) : 0,
    contributionPerMauAud: mau > 0 ? round(contribution / mau, 4) : 0,
    breakEvenMau: breakEvenMau == null ? null : Math.ceil(breakEvenMau),
  };
}

export const SIMULATOR_PRESETS: Record<string, SimulatorInput> = {
  conservative: { mau: 10000, dailyActivePercent: 12, minutesPerActiveUserDay: 8, videosPerActiveUserDay: 5, videosPerAdOpportunity: 7, fillRatePercent: 45, eCpmAud: 4, creatorPayoutPercent: 35, subscriptionConversionPercent: 0.5, subscriptionPriceAud: 12.99, infrastructureCostPerMauAud: 0.32, aiCostPerMauAud: 0.12, videoDeliveryCostPerMinuteAud: 0.0007, fixedMonthlyCostAud: 3000 },
  expected: { mau: 50000, dailyActivePercent: 18, minutesPerActiveUserDay: 12, videosPerActiveUserDay: 7, videosPerAdOpportunity: 6, fillRatePercent: 62, eCpmAud: 6.5, creatorPayoutPercent: 40, subscriptionConversionPercent: 1.4, subscriptionPriceAud: 12.99, infrastructureCostPerMauAud: 0.25, aiCostPerMauAud: 0.09, videoDeliveryCostPerMinuteAud: 0.0006, fixedMonthlyCostAud: 7000 },
  strong: { mau: 150000, dailyActivePercent: 23, minutesPerActiveUserDay: 16, videosPerActiveUserDay: 9, videosPerAdOpportunity: 6, fillRatePercent: 72, eCpmAud: 8, creatorPayoutPercent: 42, subscriptionConversionPercent: 2.2, subscriptionPriceAud: 12.99, infrastructureCostPerMauAud: 0.21, aiCostPerMauAud: 0.07, videoDeliveryCostPerMinuteAud: 0.0005, fixedMonthlyCostAud: 16000 },
  viral: { mau: 1000000, dailyActivePercent: 28, minutesPerActiveUserDay: 20, videosPerActiveUserDay: 12, videosPerAdOpportunity: 5, fillRatePercent: 68, eCpmAud: 7, creatorPayoutPercent: 45, subscriptionConversionPercent: 1.8, subscriptionPriceAud: 12.99, infrastructureCostPerMauAud: 0.19, aiCostPerMauAud: 0.08, videoDeliveryCostPerMinuteAud: 0.00048, fixedMonthlyCostAud: 65000 },
};
