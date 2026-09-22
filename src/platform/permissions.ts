export const PERMISSIONS = {
  owner: ['users.read', 'users.write', 'roles.write', 'moderation.read', 'moderation.write', 'data.read', 'data.write', 'ai.read', 'ai.write', 'settings.write', 'analytics.read', 'audit.read', 'private.read', 'finance.read', 'finance.write'],
  admin: ['users.read', 'users.write', 'moderation.read', 'moderation.write', 'data.read', 'data.write', 'ai.read', 'analytics.read', 'audit.read', 'finance.read'],
  moderator: ['moderation.read', 'moderation.write'],
  support: ['users.read'],
  data_manager: ['data.read', 'data.write'],
} as const;
export type AdminRole = keyof typeof PERMISSIONS;
export function permits(role: string | null, permission: string) { return !!role && Object.hasOwn(PERMISSIONS, role) && (PERMISSIONS[role as AdminRole] as readonly string[]).includes(permission); }
export function httpError(message: string, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
export function pageInput(query: any = {}) { const page = Number(query.page || 1), limit = Number(query.limit || 25); if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw httpError('Invalid pagination.'); return { page, limit, from: (page - 1) * limit, to: page * limit - 1 }; }
export function requireReason(body: any) { const reason = String(body?.reason || '').trim(); if (reason.length < 5 || reason.length > 1000) throw httpError('Provide a reason of 5–1000 characters.'); return reason; }
export function requireConfirmation(body: any, target: string) { if (body?.confirmation !== target) throw httpError('Type the target identifier to confirm this action.'); }
