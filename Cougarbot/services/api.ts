// services/api.ts
import axios, { AxiosError, AxiosInstance } from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import { getPickerAssetDataUris } from "../utils/imagePicker";

// ===============================
// API Base URL
// ===============================
const LAPTOP_IP = "192.168.1.100";
const ENV_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const getApiBaseUrl = (): string => {
  if (ENV_API_BASE_URL) return normalizeBaseUrl(ENV_API_BASE_URL);
  if (!__DEV__) return "https://your-api-domain.com"; // set for production builds

  if (Platform.OS === "web") return "http://127.0.0.1:8000";
  return `http://${LAPTOP_IP}:8000`;
};

export const API_BASE_URL = getApiBaseUrl();
const TOKEN_KEY = "@cougarbot:access_token";


export type Organization = {
  id: string;
  name: string;
};

// ===============================
// Helpers
// ===============================
function toAbsoluteUrl(url: string): string {
  if (!url) return url;
  return url.startsWith("http")
    ? url
    : `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function normalizePictures<T extends { pictures?: any }>(obj: T): T {
  // Normalizes { pictures: [{url}, ...] } to absolute URLs
  if (!obj || !obj.pictures || !Array.isArray(obj.pictures)) return obj;
  return {
    ...obj,
    pictures: obj.pictures.map((p: any) => ({
      ...p,
      url: p?.url ? toAbsoluteUrl(p.url) : p?.url,
    })),
  };
}

function normalizeLocationsPictures(list: any): any {
  if (!Array.isArray(list)) return list;
  return list.map((l) => normalizePictures(l));
}

function axiosErrorMessage(err: any): string {
  const ax = err as AxiosError<any>;
  const status = ax?.response?.status;
  const data = ax?.response?.data;

  const detail =
    data?.detail ??
    data?.message ??
    (typeof data === "string" ? data : null) ??
    ax?.message ??
    "Request failed";

  return status ? `HTTP ${status}: ${String(detail)}` : String(detail);
}

/**
 * Convert a local URI (file://, content://, etc.) to a base64 data URL.
 * Fallback path only. Preferred path is picker base64 (ImagePickerAsset.base64).
 */
async function uriToDataUrl(uri: string): Promise<string> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Failed to read uri: ${uri}`);

  const blob = await res.blob();
  const mime = (blob as any).type || "image/jpeg";

  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.onloadend = () => {
      const out = reader.result;
      if (typeof out !== "string" || !out.startsWith("data:")) {
        reject(new Error("Invalid data URL output"));
        return;
      }
      resolve(out);
    };
    reader.readAsDataURL(blob);
  });

  // Backend only cares it's a valid data URL; mime correctness is not strict here.
  if (!dataUrl.startsWith(`data:${mime}`) && dataUrl.startsWith("data:")) {
    // leave as-is
  }
  return dataUrl;
}

// ===============================
// Types
// ===============================
export type PictureIn = { url: string; caption?: string | null };

export type RequestStatus = "pending" | "submitted" | "approved" | "denied";
export type BusinessLevel = "high" | "moderate" | "low";

export type OrgMe = { name?: string; org_profile_pic?: string | null };

export type AnnouncementStatus = "draft" | "published";

export type ActivityLevel = "low" | "moderate" | "high";

export type ActivityRatingsResponse = {
  ratings: { level: ActivityLevel; created_at: string }[];
  can_rate: boolean;
  cooldown_until: string | null; // NOT optional (matches your state type expectation)
};

// Reviews (matches your backend response shape)
export type ReviewResponse = {
  id: string;
  location_id: string;
  location_name: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role?: string | null;
  user_profile_pic?: string | null;
  rating: number;
  review_text?: string | null;
  created_at: string;
  updated_at?: string | null;
};

// Optional normalized UI type (null -> undefined) to avoid TS errors in state
export type Review = {
  id: string;
  location_id: string;
  location_name: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role?: string;
  user_profile_pic?: string;
  rating: number;
  review_text?: string;
  created_at: string;
  updated_at?: string;
};

function normalizeReview(r: ReviewResponse): Review {
  return {
    ...r,
    user_role: r.user_role ?? undefined,
    user_profile_pic: r.user_profile_pic ?? undefined,
    review_text: r.review_text ?? undefined,
    updated_at: r.updated_at ?? undefined,
  };
}

// Profile shape used by AuthContext.getMyProfile()
export type MyProfile = {
  id: string;
  org_id?: string;
  role: "admin" | "student";
  email: string;
  name: string;
  profile_pic?: string | null;
};

// ===============================
// ApiService (SINGLE CLASS ONLY)
// ===============================
class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });

    this.api.interceptors.request.use(async (config) => {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) {
        config.headers = config.headers ?? {};
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.api.interceptors.response.use(
      (r) => r,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          await AsyncStorage.removeItem(TOKEN_KEY);
        }
        return Promise.reject(error);
      }
    );
  }

  


   async getOrganizations(): Promise<Organization[]> {
    const data = (await this.api.get("/orgs")).data as any;

    // support different backend shapes: [..] OR { orgs: [..] } OR { data: [..] }
    const list: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.orgs)
      ? data.orgs
      : Array.isArray(data?.data)
      ? data.data
      : [];

    return list
      .map((o: any) => ({
        id: String(o?.id ?? ""),
        name: String(o?.name ?? o?.id ?? ""),
      }))
      .filter((o) => o.id || o.name);
  }


  // ===============================
  // Token helpers (required by AuthContext)
  // ===============================
  async setToken(token: string | null) {
    token
      ? await AsyncStorage.setItem(TOKEN_KEY, token)
      : await AsyncStorage.removeItem(TOKEN_KEY);
  }

  async getToken(): Promise<string | null> {
    return AsyncStorage.getItem(TOKEN_KEY);
  }

  async logout(): Promise<void> {
    // Client-side logout: clear token. (If you have a backend logout endpoint later, call it here too.)
    await AsyncStorage.removeItem(TOKEN_KEY);
  }

  // ===============================
  // Auth
  // ===============================
  async login(orgId: string, email: string, password: string) {
    return (
      await this.api.post("/auth/login", { org_id: orgId, email, password })
    ).data;
  }

  async register(orgId: string, name: string, email: string, password: string) {
    return (
      await this.api.post("/auth/register", {
        org_id: orgId,
        name,
        email,
        password,
      })
    ).data;
  }

  // Needed by AuthContext
  async getMyProfile(): Promise<MyProfile> {
    const data = (await this.api.get("/users/me")).data as any;
    // normalize profile pic if present
    if (data?.profile_pic) data.profile_pic = toAbsoluteUrl(data.profile_pic);
    return data as MyProfile;
  }

  // ===============================
  // Uploads (base64 data-url pipeline)
  // ===============================
  async uploadBase64Image(dataUrl: string): Promise<string> {
    try {
      const res = await this.api.post("/uploads/base64", { data_url: dataUrl });
      const url = res.data?.url;
      if (!url) throw new Error("Upload returned no URL");
      return toAbsoluteUrl(url);
    } catch (e) {
      throw new Error(`Image upload failed (${axiosErrorMessage(e)})`);
    }
  }

  /**
   * For legacy callers that already have remote URLs or data: URLs.
   * (Does not attempt local file:// conversion.)
   */
  async buildPicturesFromUris(
    uris: string[],
    caption?: string
  ): Promise<PictureIn[]> {
    const out: PictureIn[] = [];

    for (const uri of uris ?? []) {
      if (!uri) continue;

      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        out.push({ url: uri, caption });
        continue;
      }

      if (uri.startsWith("data:")) {
        const uploadedUrl = await this.uploadBase64Image(uri);
        out.push({ url: uploadedUrl, caption });
        continue;
      }
    }

    return out;
  }

  async buildPictureFromUri(
    uri: string | null | undefined,
    caption?: string
  ): Promise<PictureIn | undefined> {
    if (!uri) return undefined;
    const pics = await this.buildPicturesFromUris([uri], caption);
    return pics[0];
  }

  /**
   * Upload 1..N images for Locations / Location Requests.
   */
  async uploadLocationImages(
    images: string[] | ImagePickerAsset[],
    caption?: string
  ): Promise<PictureIn[]> {
    const out: PictureIn[] = [];

    // Case A: ImagePickerAsset[]
    if (
      Array.isArray(images) &&
      images.length > 0 &&
      typeof images[0] !== "string"
    ) {
      const assets = images as ImagePickerAsset[];
      const dataUris = getPickerAssetDataUris(assets);

      for (const dataUrl of dataUris) {
        const uploadedUrl = await this.uploadBase64Image(dataUrl);
        out.push({ url: uploadedUrl, caption });
      }

      return out;
    }

    // Case B: string[]
    const uris = (images as string[]) ?? [];
    for (const uri of uris) {
      if (!uri) continue;

      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        out.push({ url: uri, caption });
        continue;
      }

      if (uri.startsWith("data:")) {
        const uploadedUrl = await this.uploadBase64Image(uri);
        out.push({ url: uploadedUrl, caption });
        continue;
      }

      // Fallback: local uri -> data URL -> upload
      if (
        uri.startsWith("file://") ||
        uri.startsWith("content://") ||
        uri.startsWith("ph://")
      ) {
        try {
          const dataUrl = await uriToDataUrl(uri);
          const uploadedUrl = await this.uploadBase64Image(dataUrl);
          out.push({ url: uploadedUrl, caption });
        } catch {
          continue;
        }
      }
    }

    return out;
  }

  /**
   * Convenience helper for single-image flows (Events/Announcements).
   */
  async uploadSinglePicture(
    image: ImagePickerAsset | string | null | undefined,
    caption?: string
  ): Promise<PictureIn | undefined> {
    if (!image) return undefined;

    if (typeof image === "string") {
      const pics = await this.uploadLocationImages([image], caption);
      return pics[0];
    }

    const pics = await this.uploadLocationImages([image], caption);
    return pics[0];
  }

  // ===============================
  // Org
  // ===============================
  async getMyOrg(): Promise<OrgMe> {
    const data = (await this.api.get("/org/me")).data as OrgMe;
    if (data?.org_profile_pic)
      data.org_profile_pic = toAbsoluteUrl(data.org_profile_pic);
    return data;
  }

  async updateMyOrg(data: OrgMe) {
    const payload = { ...data };
    if (payload.org_profile_pic)
      payload.org_profile_pic = toAbsoluteUrl(payload.org_profile_pic);
    return (await this.api.patch("/org/me", payload)).data;
  }

  async updateOrgName(name: string) {
    return this.updateMyOrg({ name });
  }

  async updateOrgProfilePic(org_profile_pic: string | null) {
    return this.updateMyOrg({ org_profile_pic });
  }

  // ===============================
  // Users / Members
  // ===============================
  async getUsers() {
    return (await this.api.get("/users")).data;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.api.delete(`/users/${userId}`);
  }

  async deleteStudent(email: string): Promise<void> {
    await this.api.delete(`/students/${encodeURIComponent(email)}`);
  }

  async updateUserProfile(
    userId: string,
    data: { name?: string; profile_pic?: string }
  ) {
    const payload = { ...data };
    if (payload.profile_pic)
      payload.profile_pic = toAbsoluteUrl(payload.profile_pic);
    return (await this.api.patch(`/users/${userId}`, payload)).data;
  }

  async updateUserRole(userId: string, role: "admin" | "student") {
    return (await this.api.patch(`/users/${userId}/role`, { role })).data;
  }

  // ===============================
  // Locations (posted)
  // ===============================
  async getLocations(params?: Record<string, any>) {
    const data = (await this.api.get("/locations", { params })).data;
    return normalizeLocationsPictures(data);
  }

  async getLocation(locationId: string) {
    const data = (await this.api.get(`/locations/${locationId}`)).data;
    return normalizePictures(data);
  }

  async createLocation(data: {
    name: string;
    address: string;
    pictures?: PictureIn[];
    description?: string;
    most_known_for?: string;
    level_of_business?: BusinessLevel;
  }) {
    const payload: any = { ...data };
    if (payload.pictures?.length) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }
    const out = (await this.api.post("/locations", payload)).data;
    return normalizePictures(out);
  }

  async updateLocation(
    locationId: string,
    data: {
      name?: string;
      address?: string;
      pictures?: PictureIn[];
      description?: string;
      most_known_for?: string;
      level_of_business?: BusinessLevel;
    }
  ) {
    const payload: any = { ...data };
    if (payload.pictures?.length) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }
    const out = (await this.api.put(`/locations/${locationId}`, payload)).data;
    return normalizePictures(out);
  }

  async deleteLocation(locationId: string): Promise<void> {
    await this.api.delete(`/locations/${locationId}`);
  }

  // ===============================
  // Reviews
  // ===============================
  async createReview(
    locationId: string,
    rating: number,
    review_text?: string
  ): Promise<ReviewResponse> {
    const payload = {
      rating,
      review_text: review_text?.trim() ? review_text.trim() : null,
    };
    return (
      await this.api.post(`/reviews/locations/${locationId}`, payload)
    ).data as ReviewResponse;
  }

  // Returns normalized Review[] so setReviews(...) type-checks
  async getReviews(locationId: string): Promise<Review[]> {
    const data = (await this.api.get(`/reviews/locations/${locationId}`))
      .data as ReviewResponse[];
    if (!Array.isArray(data)) return [];
    return data.map(normalizeReview);
  }

  async deleteReview(reviewId: string): Promise<void> {
    await this.api.delete(`/reviews/${reviewId}`);
  }

  async updateReview(
    reviewId: string,
    rating: number,
    review_text?: string
  ): Promise<ReviewResponse> {
    const payload = {
      rating,
      review_text: review_text?.trim() ? review_text.trim() : null,
    };
    return (await this.api.put(`/reviews/${reviewId}`, payload))
      .data as ReviewResponse;
  }

  // ===============================
  // Favorites
  // ===============================
  async addFavorite(locationId: string): Promise<void> {
    await this.api.post(`/favorites/${locationId}`);
  }

  async removeFavorite(locationId: string): Promise<void> {
    await this.api.delete(`/favorites/${locationId}`);
  }

  async getFavorites() {
    const data = (await this.api.get(`/favorites`)).data;
    return normalizeLocationsPictures(data);
  }

  // ===============================
  // Location Requests
  // ===============================
  async createLocationRequest(data: {
    name: string;
    address: string;
    pictures?: PictureIn[];
    description?: string;
    most_known_for?: string;
    level_of_business?: BusinessLevel;
  }) {
    const payload: any = { ...data };

    if (payload.pictures?.length) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }

    const out = (await this.api.post("/location-requests", payload)).data;
    return normalizePictures(out);
  }

  async getLocationRequests(params?: {
    status_filter?: RequestStatus;
    my_requests_only?: boolean;
  }) {
    const data = (await this.api.get("/location-requests", { params })).data;
    return Array.isArray(data) ? data.map((r) => normalizePictures(r)) : data;
  }

  async deleteLocationRequest(id: string): Promise<void> {
    await this.api.delete(`/location-requests/${id}`);
  }

  async updateLocationRequest(
    requestId: string,
    data: {
      name: string;
      address: string;
      pictures?: PictureIn[] | null;
      description?: string | null;
      most_known_for?: string | null;
      level_of_business?: BusinessLevel | null;
      admin_notes?: string | null;
    }
  ) {
    const payload: any = { ...data };
    if (payload.pictures?.length) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }
    const out = (await this.api.put(`/location-requests/${requestId}`, payload))
      .data;
    return normalizePictures(out);
  }

  async approveLocationRequest(requestId: string, admin_notes?: string) {
    const payload = admin_notes?.trim()
      ? { admin_notes: admin_notes.trim() }
      : {};
    return (
      await this.api.put(`/location-requests/${requestId}/approve`, payload)
    ).data;
  }

  async denyLocationRequest(requestId: string, admin_notes: string) {
    return (
      await this.api.put(`/location-requests/${requestId}/deny`, { admin_notes })
    ).data;
  }

  async updateLocationRequestStatus(
    requestId: string,
    status: RequestStatus,
    admin_notes?: string
  ) {
    return (
      await this.api.put(`/location-requests/${requestId}/status`, {
        status,
        admin_notes: admin_notes ?? null,
      })
    ).data;
  }

  async updateRequestStatus(
    requestId: string,
    status: RequestStatus,
    admin_notes?: string
  ) {
    return this.updateLocationRequestStatus(requestId, status, admin_notes);
  }

  // ===============================
  // Announcement Requests
  // ===============================
  async createAnnouncementRequest(data: {
    title: string;
    body: string;
    pictures?: PictureIn[];
    image?: string | null; // legacy
  }) {
    const payload: any = { ...data };

    if (payload.image) payload.image = toAbsoluteUrl(payload.image);

    if (payload.pictures?.length) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }

    return (await this.api.post("/announcement-requests", payload)).data;
  }

  async getAnnouncementRequests() {
    return (await this.api.get("/announcement-requests")).data;
  }

  async approveAnnouncementRequest(requestId: string) {
    return (
      await this.api.post(`/announcement-requests/${requestId}/approve`)
    ).data;
  }

  async denyAnnouncementRequest(requestId: string, admin_notes?: string) {
    return (
      await this.api.post(`/announcement-requests/${requestId}/deny`, {
        admin_notes: admin_notes ?? null,
      })
    ).data;
  }

  async deleteAnnouncementRequest(id: string): Promise<void> {
    await this.api.delete(`/announcement-requests/${id}`);
  }

  // ===============================
  // Announcements (posted)
  // ===============================
  async getAnnouncements() {
    return (await this.api.get("/announcements")).data;
  }

  async getAnnouncement(id: string) {
    return (await this.api.get(`/announcements/${id}`)).data;
  }

  async createAnnouncement(data: {
    title: string;
    body: string;
    pictures?: PictureIn[];
    image?: string | null; // legacy
  }) {
    const payload: any = { ...data };

    if (payload.image) payload.image = toAbsoluteUrl(payload.image);

    if (payload.pictures?.length) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }

    return (await this.api.post("/announcements", payload)).data;
  }

  async patchAnnouncement(
    id: string,
    data: Partial<{
      title: string;
      body: string;
      status: AnnouncementStatus;
      pictures: PictureIn[] | null;
      image: string | null; // legacy
    }>
  ) {
    const payload: any = { ...data };

    if (payload.pictures) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }

    if (payload.image) payload.image = toAbsoluteUrl(payload.image);

    return (await this.api.patch(`/announcements/${id}`, payload)).data;
  }

  async publishAnnouncement(id: string) {
    return (await this.api.post(`/announcements/${id}/publish`)).data;
  }

  async unpublishAnnouncement(id: string) {
    return (await this.api.post(`/announcements/${id}/unpublish`)).data;
  }

  async deleteAnnouncement(id: string): Promise<void> {
    await this.api.delete(`/announcements/${id}`);
  }

  async getAnnouncementComments(announcementId: string) {
    return (await this.api.get(`/announcements/${announcementId}/comments`))
      .data;
  }

  async createAnnouncementComment(announcementId: string, body: string) {
    return (
      await this.api.post(`/announcements/${announcementId}/comments`, { body })
    ).data;
  }

  async deleteAnnouncementComment(
    announcementId: string,
    commentId: string
  ): Promise<void> {
    await this.api.delete(
      `/announcements/${announcementId}/comments/${commentId}`
    );
  }

  // ===============================
  // Event Requests
  // ===============================
  async createEventRequest(data: {
    event_name: string;
    location?: string;
    top_qualities?: string;
    description?: string;
    meeting_time?: string;
    pictures?: PictureIn[];
    picture?: string | null; // legacy
  }) {
    const payload: any = { ...data };

    if (payload.picture) payload.picture = toAbsoluteUrl(payload.picture);

    if (payload.pictures?.length) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }

    return (await this.api.post("/event-requests", payload)).data;
  }

  async getEventRequests() {
    return (await this.api.get("/event-requests")).data;
  }

  async updateEventRequest(
    requestId: string,
    data: Partial<{
      event_name: string;
      location: string | null;
      top_qualities: string | null;
      description: string | null;
      meeting_time: string | null;
      pictures: PictureIn[] | null;
      picture: string | null; // legacy
      admin_notes: string | null;
    }>
  ) {
    const payload: any = { ...data };

    if (payload.picture) payload.picture = toAbsoluteUrl(payload.picture);

    if (payload.pictures) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }

    return (await this.api.put(`/event-requests/${requestId}`, payload)).data;
  }

  async approveEventRequest(requestId: string) {
    return (await this.api.post(`/event-requests/${requestId}/approve`)).data;
  }

  async denyEventRequest(requestId: string, admin_notes?: string) {
    return (
      await this.api.post(`/event-requests/${requestId}/deny`, {
        admin_notes: admin_notes ?? null,
      })
    ).data;
  }

  async deleteEventRequest(id: string): Promise<void> {
    await this.api.delete(`/event-requests/${id}`);
  }

  // ===============================
  // Events (posted)
  // ===============================
  async getEvents() {
    return (await this.api.get("/events")).data;
  }

  async createEvent(data: {
    event_name: string;
    location?: string;
    top_qualities?: string;
    description?: string;
    meeting_time?: string;
    pictures?: PictureIn[];
    picture?: string | null; // legacy
  }) {
    const payload: any = { ...data };

    if (payload.picture) payload.picture = toAbsoluteUrl(payload.picture);

    if (payload.pictures?.length) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }

    return (await this.api.post("/events", payload)).data;
  }

  async patchEvent(
    id: string,
    data: Partial<{
      event_name: string;
      location: string;
      top_qualities: string;
      description: string;
      meeting_time: string;
      pictures: PictureIn[] | null;
      picture: string | null; // legacy
    }>
  ) {
    const payload: any = { ...data };

    if (payload.picture) payload.picture = toAbsoluteUrl(payload.picture);

    if (payload.pictures) {
      payload.pictures = payload.pictures.map((p: PictureIn) => ({
        ...p,
        url: toAbsoluteUrl(p.url),
      }));
    }

    return (await this.api.patch(`/events/${id}`, payload)).data;
  }


   
  async deleteEvent(id: string): Promise<void> {
    await this.api.delete(`/events/${id}`);
  }

  // ===============================
  // Location Activity Ratings
  // ===============================
  async getLocationActivityRatings(
    locationId: string
  ): Promise<ActivityRatingsResponse> {
    const raw = (await this.api.get(`/locations/${locationId}/activity-ratings`))
      .data as any;

    return {
      ratings: Array.isArray(raw?.ratings) ? raw.ratings : [],
      can_rate: Boolean(raw?.can_rate),
      cooldown_until: raw?.cooldown_until ?? null, // converts undefined -> null
    };
  }

  async submitLocationActivityRating(locationId: string, level: ActivityLevel) {
    return (
      await this.api.post(`/locations/${locationId}/activity-ratings`, { level })
    ).data;
  }
}

export const apiService = new ApiService();
