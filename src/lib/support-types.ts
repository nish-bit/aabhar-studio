/**
 * Shapes the Plans page's invite, refund-request and support-ticket APIs
 * return. Shared by the browser and the server.
 */
export interface ReferralSummary {
  code: string;
  invited: number;
  rewarded: number;
  creditsEarned: number;
  referrerCredits: number;
  refereeCredits: number;
}

export interface RefundableImage {
  generatedImageId: string;
  url: string;
  styleName: string;
  creditCost: number;
  createdAt: string;
}

export interface RefundRequestView {
  id: string;
  status: "pending" | "approved" | "rejected";
  reason: string;
  creditsRequested: number;
  creditsReturned: number;
  adminNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  images: { generatedImageId: string; url: string | null; styleName: string }[];
}

export interface AdminRefundRequestView extends RefundRequestView {
  email: string | null;
  shopId: string;
  images: { generatedImageId: string; url: string | null; originalUrl: string | null; styleName: string }[];
}

export interface TicketView {
  id: string;
  reference: string;
  subject: string;
  description: string;
  status: "open" | "answered" | "closed";
  adminResponse: string | null;
  respondedAt: string | null;
  createdAt: string;
  email: string | null;
}
