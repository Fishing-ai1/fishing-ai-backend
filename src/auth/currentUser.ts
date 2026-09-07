export type CurrentUser = {
  id: string;
  email?: string | null;
  role?: string | null;
};

export function requireCurrentUser(user: CurrentUser | null | undefined): CurrentUser {
  if (!user?.id) {
    const error = new Error("Authentication required.");
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }
  return user;
}
