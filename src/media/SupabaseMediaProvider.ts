import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaProvider, MediaUploadTicket, MediaUploadTicketRequest } from "./MediaProvider";

export class SupabaseMediaProvider implements MediaProvider {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async createUploadTicket(request: MediaUploadTicketRequest): Promise<MediaUploadTicket> {
    const safeName = request.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectPath = `${request.ownerId}/${Date.now()}-${safeName}`;
    const signed = await this.supabase.storage.from(this.bucket).createSignedUploadUrl(objectPath, {
      upsert: false,
    });
    if (signed.error) throw signed.error;
    const publicUrl = this.supabase.storage.from(this.bucket).getPublicUrl(objectPath).data.publicUrl;
    return {
      provider: "supabase",
      assetId: objectPath,
      uploadUrl: signed.data.signedUrl,
      publicUrl,
      metadata: {
        token: signed.data.token,
        path: objectPath,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        purpose: request.purpose,
      },
    };
  }
}
