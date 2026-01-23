// services/api.ts
import axios, { AxiosError, AxiosInstance } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

// ===============================
// API Base URL Configuration
// ===============================
const LAPTOP_IP = '192.168.1.100'; // CHANGE to your local IPv4 if needed

const ENV_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, '');

const getApiBaseUrl = (): string => {
  if (ENV_API_BASE_URL) return normalizeBaseUrl(ENV_API_BASE_URL);

  if (!__DEV__) {
    return 'https://your-api-domain.com'; // Production
  }

  // Web (laptop browser)
  if (Platform.OS === 'web') return 'http://127.0.0.1:8000';

  // Mobile (device) needs laptop LAN IP
  return `http://${LAPTOP_IP}:8000`;
};

const API_BASE_URL = getApiBaseUrl();

// Token storage key
const TOKEN_KEY = '@cougarbot:access_token';

// ===============================
// Helpers
// ===============================
function inferMimeType(uri?: string, fallback = 'image/jpeg'): string {
  if (!uri) return fallback;
  const clean = uri.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.heic')) return 'image/heic';
  if (clean.endsWith('.webp')) return 'image/webp';
  return fallback;
}

function toAbsoluteUrl(url: string): string {
  if (!url) return url;
  return url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function axiosErrorMessage(err: any): string {
  const ax = err as AxiosError<any>;
  const status = ax?.response?.status;
  const detail =
    (ax?.response?.data as any)?.detail ??
    (ax?.response?.data as any)?.message ??
    ax?.message ??
    'Request failed';

  return status ? `${status}: ${String(detail)}` : String(detail);
}

// Use `any` wrapper so TypeScript stops complaining if its snapshot is stale.
const FS: any = FileSystem;

// Encoding fallback:
// - Prefer FS.EncodingType.Base64 if it exists
// - Else fallback to string 'base64' (supported at runtime)
const BASE64_ENCODING: any = FS?.EncodingType?.Base64 ?? 'base64';

function isReadableFileUri(uri: string): boolean {
  return uri.startsWith('file://');
}

// Resolve iOS ph:// URIs if we need to read them
async function resolveIosPhotoUriIfNeeded(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const uri = asset.uri;
  if (!uri) throw new Error('Selected image is missing a URI');

  if (!uri.startsWith('ph://')) return uri;

  if (asset.assetId) {
    const info = await MediaLibrary.getAssetInfoAsync(asset.assetId);
    if (info?.localUri) return info.localUri;
  }

  throw new Error(
    `iOS photo URI (ph://) must be resolved to file:// before reading. ` +
      `Ensure MediaLibrary permissions are granted and the picker returns assetId. URI=${uri}`
  );
}

async function readBase64FromUri(uri: string): Promise<string> {
  // If it's already file://, read directly
  if (isReadableFileUri(uri)) {
    return await FS.readAsStringAsync(uri, { encoding: BASE64_ENCODING });
  }

  // Attempt: copy to app cache then read (helps for some content:// URIs)
  const extGuess = (() => {
    const clean = uri.split('?')[0].toLowerCase();
    if (clean.endsWith('.png')) return 'png';
    if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'jpg';
    if (clean.endsWith('.heic')) return 'heic';
    if (clean.endsWith('.webp')) return 'webp';
    return 'jpg';
  })();

  const baseDir = FS.cacheDirectory ?? FS.documentDirectory;
  if (!baseDir) {
    throw new Error('No writable directory available (cacheDirectory/documentDirectory are null).');
  }

  const dest = `${baseDir}upload_${Date.now()}.${extGuess}`;

  try {
    await FS.copyAsync({ from: uri, to: dest });
    return await FS.readAsStringAsync(dest, { encoding: BASE64_ENCODING });
  } catch {
    throw new Error(
      `Cannot read image data from URI. If this is iOS and the URI starts with "ph://", resolve it to file:// first. URI=${uri}`
    );
  } finally {
    await FS.deleteAsync(dest, { idempotent: true }).catch(() => {});
  }
}

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      headers: { 'Content-Type': 'application/json' },
    });

    this.api.interceptors.request.use(
      async (config) => {
        const token = await AsyncStorage.getItem(TOKEN_KEY);
        if (token) {
          config.headers = config.headers ?? {};
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.api.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          await AsyncStorage.removeItem(TOKEN_KEY);
        }
        return Promise.reject(error);
      }
    );
  }

  async setToken(token: string | null): Promise<void> {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  }

  async getToken(): Promise<string | null> {
    return await AsyncStorage.getItem(TOKEN_KEY);
  }

  async logout(): Promise<void> {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }

  // ===============================
  // Auth endpoints
  // ===============================
  async login(orgId: string, email: string, password: string) {
    const response = await this.api.post('/auth/login', { org_id: orgId, email, password });
    return response.data;
  }

  async register(orgId: string, name: string, email: string, password: string) {
    const response = await this.api.post('/auth/register', { org_id: orgId, name, email, password });
    return response.data;
  }

  async refreshToken(orgId: string, refreshToken: string) {
    const response = await this.api.post('/auth/refresh', { org_id: orgId, refresh_token: refreshToken });
    return response.data;
  }

  // ===============================
  // Organization endpoints
  // ===============================
  async getOrganizations() {
    const response = await this.api.get('/orgs');
    return response.data;
  }

  async getMyOrg() {
    const response = await this.api.get('/orgs/me');
    return response.data;
  }

  async updateOrgProfilePic(orgProfilePic: string | null) {
    const response = await this.api.patch('/orgs/me', { org_profile_pic: orgProfilePic });
    return response.data;
  }

  async updateOrgName(name: string) {
    const response = await this.api.patch('/orgs/me', { name: name.trim() });
    return response.data;
  }

  async registerOrganization(data: {
    org_name: string;
    allowed_email_domains?: string[];
    org_profile_pic?: string | null;
    admin_name: string;
    admin_email: string;
    admin_password: string;
  }) {
    const response = await this.api.post('/orgs/register', data);
    return response.data;
  }

  // ===============================
  // Uploads
  // ===============================
  async uploadBase64Image(dataUrl: string): Promise<string> {
    try {
      const response = await this.api.post('/uploads/base64', { data_url: dataUrl });
      const url = response.data?.url;
      if (!url) throw new Error('Upload failed: missing URL in response');
      return toAbsoluteUrl(url);
    } catch (e: any) {
      throw new Error(`Image upload failed (${axiosErrorMessage(e)})`);
    }
  }

  async uploadLocationImages(images: ImagePicker.ImagePickerAsset[]): Promise<Array<{ url: string }>> {
    const uploaded: Array<{ url: string }> = [];

    for (const asset of images) {
      let base64 = asset.base64;

      if (!base64) {
        let uri = asset.uri;
        if (!uri) throw new Error('Selected image is missing a URI');

        if (uri.startsWith('ph://')) {
          uri = await resolveIosPhotoUriIfNeeded(asset);
        }

        base64 = await readBase64FromUri(uri);
      }

      const mimeType = asset.mimeType || inferMimeType(asset.uri, 'image/jpeg');
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const url = await this.uploadBase64Image(dataUrl);
      uploaded.push({ url });
    }

    return uploaded;
  }

  // ===============================
  // Location endpoints
  // ===============================
  async getLocations(params?: {
    search?: string;
    level_of_business?: 'high' | 'moderate' | 'low';
    min_rating?: number;
    created_since_hours?: number;
    sort?: 'recent' | 'activity';
    activity_since_hours?: number;
  }) {
    const response = await this.api.get('/locations', { params });
    return response.data;
  }

  async getLocation(locationId: string) {
    const response = await this.api.get(`/locations/${locationId}`);
    return response.data;
  }

  async createLocation(data: {
    name: string;
    address: string;
    pictures?: Array<{ url: string; caption?: string }>;
    description?: string;
    most_known_for?: string;
    level_of_business?: 'high' | 'moderate' | 'low';
  }) {
    const response = await this.api.post('/locations', data);
    return response.data;
  }

  async updateLocation(
    locationId: string,
    data: {
      name: string;
      address: string;
      pictures?: Array<{ url: string; caption?: string }>;
      description?: string;
      most_known_for?: string;
      level_of_business?: 'high' | 'moderate' | 'low';
    }
  ) {
    const response = await this.api.put(`/locations/${locationId}`, data);
    return response.data;
  }

  async deleteLocation(locationId: string) {
    await this.api.delete(`/locations/${locationId}`);
  }

  // ===============================
  // Review endpoints
  // ===============================
  async getReviews(locationId: string) {
    const response = await this.api.get(`/reviews/locations/${locationId}`);
    return response.data;
  }

  async createReview(locationId: string, rating: number, reviewText?: string) {
    const response = await this.api.post(`/reviews/locations/${locationId}`, {
      rating,
      review_text: reviewText?.trim() || undefined,
    });
    return response.data;
  }

  async updateReview(reviewId: string, rating: number, reviewText?: string) {
    const response = await this.api.put(`/reviews/${reviewId}`, { rating, review_text: reviewText });
    return response.data;
  }

  async deleteReview(reviewId: string) {
    const response = await this.api.delete(`/reviews/${reviewId}`);
    return response.data;
  }

  // ===============================
  // Activity ratings
  // ===============================
  async getLocationActivityRatings(locationId: string): Promise<{
    ratings: Array<{ level: string; created_at: string }>;
    can_rate: boolean;
    cooldown_until: string | null;
  }> {
    const response = await this.api.get(`/locations/${locationId}/activity-ratings`);
    return response.data;
  }

  async submitLocationActivityRating(
    locationId: string,
    level: 'low' | 'moderate' | 'high'
  ): Promise<{ level: string; created_at: string }> {
    const response = await this.api.post(`/locations/${locationId}/activity-ratings`, { level });
    return response.data;
  }

  // ===============================
  // Favorites
  // ===============================
  async getFavorites() {
    const response = await this.api.get('/favorites');
    return response.data;
  }

  async addFavorite(locationId: string) {
    await this.api.post(`/favorites/${locationId}`);
  }

  async removeFavorite(locationId: string) {
    await this.api.delete(`/favorites/${locationId}`);
  }

  // ===============================
  // Location request endpoints
  // ===============================
  async getLocationRequests(status?: 'pending' | 'approved' | 'denied') {
    const params = status ? { status_filter: status } : {};
    const response = await this.api.get('/location-requests', { params });
    return response.data;
  }

  async createLocationRequest(data: {
    name: string;
    address: string;
    pictures?: Array<{ url: string; caption?: string }>;
    description?: string;
    most_known_for?: string;
    level_of_business?: 'high' | 'moderate' | 'low';
  }) {
    const response = await this.api.post('/location-requests', data);
    return response.data;
  }

  async approveLocationRequest(requestId: string, adminNotes?: string) {
    const response = await this.api.put(`/location-requests/${requestId}/approve`, { admin_notes: adminNotes });
    return response.data;
  }

  async denyLocationRequest(requestId: string, adminNotes: string) {
    const response = await this.api.put(`/location-requests/${requestId}/deny`, { admin_notes: adminNotes });
    return response.data;
  }

  async deleteLocationRequest(requestId: string) {
    const response = await this.api.delete(`/location-requests/${requestId}`);
    return response.data;
  }

  async updateRequestStatus(
    requestId: string,
    status: 'pending' | 'submitted' | 'approved' | 'denied',
    adminNotes?: string
  ) {
    const response = await this.api.put(`/location-requests/${requestId}/status`, {
      status,
      admin_notes: adminNotes,
    });
    return response.data;
  }

  async updateLocationRequest(
    requestId: string,
    data: {
      name: string;
      address: string;
      description?: string;
      pictures?: Array<{ url: string; caption?: string }>;
      most_known_for?: string;
      level_of_business?: 'high' | 'moderate' | 'low';
      admin_notes?: string;
    }
  ) {
    const response = await this.api.put(`/location-requests/${requestId}`, data);
    return response.data;
  }

  // ===============================
  // User profile endpoints
  // ===============================
  async getMyProfile() {
    const response = await this.api.get('/users/me');
    return response.data;
  }

  async updateProfile(data: { name?: string; profile_pic?: string }) {
    const response = await this.api.put('/users/me', data);
    return response.data;
  }

  async getUsers(role?: 'admin' | 'student') {
    const params = role ? { role } : {};
    const response = await this.api.get('/users', { params });
    return response.data;
  }

  async deleteStudent(email: string) {
    const response = await this.api.delete('/users', { params: { email } });
    return response.data;
  }

  async updateUserName(userId: string, name: string) {
    const response = await this.api.put(`/users/${userId}/name`, { name });
    return response.data;
  }

  async updateUserProfile(userId: string, data: { name?: string; profile_pic?: string }) {
    const response = await this.api.put(`/users/${userId}/profile`, data);
    return response.data;
  }

  async updateUserRole(userId: string, role: 'admin' | 'student') {
    const response = await this.api.put(`/users/${userId}/role`, { role });
    return response.data;
  }

  async deleteUser(userId: string) {
    const response = await this.api.delete(`/users/${userId}`);
    return response.data;
  }

  // ===============================
  // Announcements
  // ===============================
  async getAnnouncements() {
    const response = await this.api.get('/announcements');
    return response.data;
  }

  async getAnnouncement(id: string) {
    const response = await this.api.get(`/announcements/${id}`);
    return response.data;
  }

  async createAnnouncement(data: { title: string; body: string; image?: string }) {
    const response = await this.api.post('/announcements', data);
    return response.data;
  }

  async patchAnnouncement(id: string, data: { title?: string; body?: string; status?: 'draft' | 'published'; image?: string }) {
    const response = await this.api.patch(`/announcements/${id}`, data);
    return response.data;
  }

  async publishAnnouncement(id: string) {
    const response = await this.api.post(`/announcements/${id}/publish`);
    return response.data;
  }

  async unpublishAnnouncement(id: string) {
    const response = await this.api.post(`/announcements/${id}/unpublish`);
    return response.data;
  }

  async deleteAnnouncement(id: string) {
    await this.api.delete(`/announcements/${id}`);
  }

  async getAnnouncementComments(announcementId: string) {
    const response = await this.api.get(`/announcements/${announcementId}/comments`);
    return response.data;
  }

  async createAnnouncementComment(announcementId: string, body: string) {
    const response = await this.api.post(`/announcements/${announcementId}/comments`, { body });
    return response.data;
  }

  async deleteAnnouncementComment(announcementId: string, commentId: string) {
    await this.api.delete(`/announcements/${announcementId}/comments/${commentId}`);
  }

  async getAnnouncementRequests() {
    const response = await this.api.get('/announcement-requests');
    return response.data;
  }

  async createAnnouncementRequest(data: { title: string; body: string; image?: string }) {
    const response = await this.api.post('/announcement-requests', data);
    return response.data;
  }

  async approveAnnouncementRequest(requestId: string) {
    const response = await this.api.post(`/announcement-requests/${requestId}/approve`);
    return response.data;
  }

  async denyAnnouncementRequest(requestId: string, adminNotes?: string) {
    const response = await this.api.post(`/announcement-requests/${requestId}/deny`, {
      admin_notes: adminNotes || undefined,
    });
    return response.data;
  }

  async deleteAnnouncementRequest(requestId: string) {
    const response = await this.api.delete(`/announcement-requests/${requestId}`);
    return response.data;
  }

  // ===============================
  // Events
  // ===============================
  async getEvents() {
    const response = await this.api.get('/events');
    return response.data;
  }

  async createEvent(data: {
    event_name: string;
    location?: string;
    top_qualities?: string;
    description?: string;
    picture?: string;
    meeting_time?: string;
  }) {
    const response = await this.api.post('/events', data);
    return response.data;
  }

  async patchEvent(
    eventId: string,
    data: {
      event_name?: string;
      location?: string;
      top_qualities?: string;
      description?: string;
      picture?: string;
      meeting_time?: string;
    }
  ) {
    const response = await this.api.patch(`/events/${eventId}`, data);
    return response.data;
  }

  async deleteEvent(eventId: string) {
    await this.api.delete(`/events/${eventId}`);
  }

  async getEventRequests() {
    const response = await this.api.get('/event-requests');
    return response.data;
  }

  async createEventRequest(data: {
    event_name: string;
    location?: string;
    top_qualities?: string;
    description?: string;
    picture?: string;
    meeting_time?: string;
  }) {
    const response = await this.api.post('/event-requests', data);
    return response.data;
  }

  async updateEventRequest(
    requestId: string,
    data: {
      event_name?: string;
      location?: string;
      top_qualities?: string;
      description?: string;
      picture?: string;
      meeting_time?: string;
      admin_notes?: string;
    }
  ) {
    const response = await this.api.put(`/event-requests/${requestId}`, data);
    return response.data;
  }

  async approveEventRequest(requestId: string) {
    const response = await this.api.post(`/event-requests/${requestId}/approve`);
    return response.data;
  }

  async denyEventRequest(requestId: string, adminNotes?: string) {
    const response = await this.api.post(`/event-requests/${requestId}/deny`, {
      admin_notes: adminNotes || undefined,
    });
    return response.data;
  }

  async deleteEventRequest(requestId: string) {
    return (await this.api.delete(`/event-requests/${requestId}`)).data;
  }
}

export const apiService = new ApiService();
export { API_BASE_URL };
