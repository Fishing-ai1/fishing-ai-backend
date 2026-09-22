import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { calculateFinancialHealth, simulateEconomics, videoAdSchedule } from '../src/monetization/financial.ts';
import { fixture, adapter, OWNER, MODERATOR } from './fixture.ts';
import { registerPlatform } from '../src/platform/routes.ts';
import { aiConfig } from '../src/platform/ai.ts';

test('video ad schedule respects short-form and duration bands', () => {
  assert.deepEqual(videoAdSchedule(59), []);
  assert.deepEqual(videoAdSchedule(120), [{ placement: 'pre_roll', atSeconds: 0 }]);
  assert.deepEqual(videoAdSchedule(240), [{ placement: 'pre_roll', atSeconds: 0 }, { placement: 'mid_roll', atSeconds: 180 }]);
  assert.deepEqual(videoAdSchedule(900).map(item => item.atSeconds), [0, 180, 480, 780]);
});

test('financial health follows contribution thresholds and never treats no data as green', () => {
  assert.equal(calculateFinancialHealth({ totalRevenue: 0, directPlatformCost: 0, creatorPayoutLiability: 0 }).status, 'no_data');
  assert.equal(calculateFinancialHealth({ totalRevenue: 200, directPlatformCost: 100, creatorPayoutLiability: 20 }).status, 'green');
  assert.equal(calculateFinancialHealth({ totalRevenue: 140, directPlatformCost: 100, creatorPayoutLiability: 10 }).status, 'amber');
  assert.equal(calculateFinancialHealth({ totalRevenue: 110, directPlatformCost: 90, creatorPayoutLiability: 10 }).status, 'red');
  assert.equal(calculateFinancialHealth({ totalRevenue: 80, directPlatformCost: 90, creatorPayoutLiability: 10 }).status, 'critical');
});

test('simulator derives revenue from paid impressions rather than video views', () => {
  const result = simulateEconomics({ mau: 1000, dailyActivePercent: 10, minutesPerActiveUserDay: 10, videosPerActiveUserDay: 6, videosPerAdOpportunity: 6, fillRatePercent: 50, eCpmAud: 10, creatorPayoutPercent: 40, subscriptionConversionPercent: 0, subscriptionPriceAud: 12.99, infrastructureCostPerMauAud: 0.1, aiCostPerMauAud: 0.05, videoDeliveryCostPerMinuteAud: 0.001, fixedMonthlyCostAud: 100 });
  assert.equal(result.monthlyVideoViews, 18000);
  assert.equal(result.adOpportunities, 3000);
  assert.equal(result.paidImpressions, 1500);
  assert.equal(result.adRevenueAud, 15);
  assert.equal(result.creatorPayoutAud, 6);
  assert.equal(result.platformCostAud, 280);
  assert.equal(result.contributionAud, -271);
});

test('financial control API is permissioned and returns no-data truthfully', async () => {
  const pg = await fixture();
  const app = Fastify();
  registerPlatform(app, { db: adapter(pg), enabled: true, owner: user => user.id === OWNER, auth: async req => ({ id: req.headers['x-test-user'] || OWNER }), gateway: { config: aiConfig({}) } });
  try {
    const denied = await app.inject({ url: '/admin/control/financial/weekly', headers: { 'x-test-user': MODERATOR } });
    assert.equal(denied.statusCode, 403);
    const weekly = await app.inject({ url: '/admin/control/financial/weekly', headers: { 'x-test-user': OWNER } });
    assert.equal(weekly.statusCode, 200, weekly.body);
    assert.equal(weekly.json().report.health.status, 'no_data');
    const simulation = await app.inject({ method: 'POST', url: '/admin/control/financial/simulate', headers: { 'x-test-user': OWNER }, payload: { preset: 'expected', input: {} } });
    assert.equal(simulation.statusCode, 200, simulation.body);
    assert.equal(simulation.json().value_status, 'projected');
    assert.ok(simulation.json().scenario.paidImpressions > 0);
  } finally {
    await app.close();
    await pg.close();
  }
});
