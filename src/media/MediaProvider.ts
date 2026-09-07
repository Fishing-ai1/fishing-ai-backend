export type MediaUploadTicketRequest = {
  ownerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: "post" | "video" | "short" | "profile" | "boat" | "message";
};

export type MediaUploadTicket = {
  provider: string;
  assetId: string;
  uploadUrl?: string;
  publicUrl?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
};

export interface MediaProvider {
  createUploadTicket(request: MediaUploadTicketRequest): Promise<MediaUploadTicket>;
}
