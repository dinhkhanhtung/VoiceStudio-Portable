export const API_BASE_URL = "/api";

// Declare electron bridge interfaces
declare global {
  interface Window {
    appAuth?: {
      getToken: () => Promise<string>;
    };
  }
}

let cachedToken: string | null = null;

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (typeof window !== "undefined" && window.appAuth) {
    if (!cachedToken) {
      cachedToken = await window.appAuth.getToken();
    }
    if (cachedToken) {
      headers["x-app-token"] = cachedToken;
    }
  }
  return headers;
}

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender: string;
  style: string;
  audio_sample?: string;
}

export interface LicenseStatus {
  licensed: boolean;
  machineId: string;
  expiry: string | null;
}

export async function checkLicenseStatus(): Promise<LicenseStatus> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/license/status`, { headers });
  if (!res.ok) throw new Error("Failed to fetch license status");
  return res.json();
}

export async function fetchVoices(): Promise<Voice[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/voices`, { headers });
  if (!res.ok) throw new Error("Failed to fetch voices");
  return res.json();
}

export interface SynthesizeOptions {
  voiceId: string;
  text: string;
  speed?: number;
  pauseMs?: number;
  engine?: string;
}

export interface SynthesizeResponse {
  success: boolean;
  audioUrl?: string;
  error?: string;
  details?: string;
}

export async function synthesizeAudio(options: SynthesizeOptions): Promise<SynthesizeResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE_URL}/synthesize`, {
    method: "POST",
    headers,
    body: JSON.stringify(options),
  });
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || "Synthesis failed");
  }
  
  return res.json();
}
