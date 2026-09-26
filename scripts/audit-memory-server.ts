// This fixture is never imported by the application entry point.
if (process.env.NODE_ENV !== 'test' || process.env.OCEANCORE_TEST_MODE !== 'true' || !process.send) {
  throw new Error('Run this fixture through the isolated full-audit harness.');
}
const { app } = await import('../server.ts');
app.addHook('onRequest', async (request: any) => {
  const actor = ['2','3'].includes(request.headers['x-audit-user']) ? request.headers['x-audit-user'] : '1';
  request.ocAuthenticatedUser = {
    id: '00000000-0000-0000-0000-00000000000'+actor,
    email: 'guest@oceancore.local',
    isGuest: true,
    user_metadata: {},
  };
});
const url = await app.listen({ host: '127.0.0.1', port: 0 });
process.send({ url });
