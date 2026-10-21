import axios from 'axios';
import { post } from './tabGuard';

const api = axios.create({
  // Development (npm start): the API runs on the screen port + 2000 (3100 -> 5100,
  // 3101 -> 5101). A release is served by the API itself: same address, /api.
  baseURL: process.env.REACT_APP_API_URL || (process.env.NODE_ENV === 'development' && window.location.port
    ? `${window.location.protocol}//${window.location.hostname}:${Number(window.location.port) + 2000}/api`
    : '/api'),
});

// Session token kept for this browser tab only, like sessionStorage in Index.html
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('faSessionToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// An expired session returns to the login page (handleSessionExpired); a
// session ended by a sign-in on another browser, or by inactivity, says so
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && sessionStorage.getItem('faSessionToken')) {
      sessionStorage.removeItem('faSessionToken');
      sessionStorage.removeItem('faUser');
      post('logout'); // the session is gone for every tab of this browser
      const code = error.response.data?.code;
      window.location.href = code === 'SESSION_REPLACED' ? '/login?replaced=1' : code === 'SESSION_IDLE' ? '/login?idle=1' : code === 'SESSION_ENDED_BY_ADMIN' ? '/login?ended=1' : '/login?expired=1';
    }
    return Promise.reject(error);
  }
);

// Server message of a failed request (getErrorMessage)
export function errorMessage(err) {
  return err?.response?.data?.message || err?.message || 'An unexpected error occurred.';
}

// Calls the API and returns the response body. background: an automatic
// request (refresh, keep-alive) that does not count as user activity.
export async function call(method, url, data, { background = false } = {}) {
  const res = await api.request({ method, url, data, headers: background ? { 'X-Background': '1' } : undefined });
  return res.data;
}

// Uploads one Excel file as 'file', with optional form fields (sent first)
export async function uploadFile(url, file, fields = {}) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v ?? ''));
  form.append('file', file);
  return (await api.post(url, form)).data;
}

// Downloads an Excel file; returns the row count the server reports
export async function download(url, fallbackName = 'download.xlsx') {
  let res;
  try {
    res = await api.get(url, { responseType: 'blob' });
  } catch (err) {
    // error bodies arrive as blobs too
    const body = err.response?.data;
    if (body instanceof Blob) {
      try { err.response.data = JSON.parse(await body.text()); } catch { /* not JSON */ }
    }
    throw err;
  }
  const match = (res.headers['content-disposition'] || '').match(/filename="?([^"]+)"?/);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(res.data);
  link.download = match ? match[1] : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  return Number(res.headers['x-row-count'] || 0);
}

export default api;
