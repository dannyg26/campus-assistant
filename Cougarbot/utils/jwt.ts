/**
 * Simple JWT decoder without verification.
 * This decodes the token payload to get user information.
 * Token verification is handled by the backend.
 */

interface JWTPayload {
  sub?: string; // user_id
  org_id?: string;
  role?: 'admin' | 'student';
  email?: string;
  name?: string;
  exp?: number;
  iss?: string;
  iat?: number;
}

export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    
    // Add padding if needed for base64 decode
    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }

    // Decode base64 - use Buffer for Node.js/React Native compatibility
    let decoded: string;
    if (typeof atob !== 'undefined') {
      // Browser environment
      decoded = atob(base64);
    } else if (typeof Buffer !== 'undefined') {
      // Node.js/React Native environment
      decoded = Buffer.from(base64, 'base64').toString('utf-8');
    } else {
      // Fallback for React Native
      // Simple base64 decode without external library
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let result = '';
      let i = 0;
      while (i < base64.length) {
        const enc1 = chars.indexOf(base64.charAt(i++));
        const enc2 = chars.indexOf(base64.charAt(i++));
        const enc3 = chars.indexOf(base64.charAt(i++));
        const enc4 = chars.indexOf(base64.charAt(i++));
        const bitmap = (enc1 << 18) | (enc2 << 12) | (enc3 << 6) | enc4;
        result += String.fromCharCode((bitmap >> 16) & 255);
        if (enc3 !== 64) result += String.fromCharCode((bitmap >> 8) & 255);
        if (enc4 !== 64) result += String.fromCharCode(bitmap & 255);
      }
      decoded = result;
    }
    return JSON.parse(decoded) as JWTPayload;
  } catch (error) {
    return null;
  }
}
