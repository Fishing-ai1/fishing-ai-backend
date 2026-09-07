import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseConfig = {
  url: string;
  serviceKey: string;
};

export function createServerSupabaseClient(config: SupabaseConfig): SupabaseClient {
  if (!config.url) throw new Error("SUPABASE_URL is required.");
  if (!config.serviceKey) throw new Error("SUPABASE_SERVICE_KEY is required on the backend.");
  return createClient(config.url, config.serviceKey);
}
