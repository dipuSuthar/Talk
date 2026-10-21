import axios from "axios";

// The access token lives only in memory (not localStorage) so XSS can't steal a long-lived credential.
// The long-lived refresh token is an httpOnly cookie the JS can't read at all.
let accessToken = null;
const listeners = new Set();
export const getToken = () => accessToken;
export const setToken = (t) => {
  accessToken = t;
  listeners.forEach((fn) => fn(t));
};
export const onTokenChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export const api = axios.create({ baseURL: "/api", withCredentials: true, timeout: 30_000 });

api.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

let refreshing = null;
export function refreshSession() {
  // Many requests can fail at once when the token expires; share ONE refresh call between them.
  refreshing ??= axios
    .post("/api/auth/refresh", null, { withCredentials: true, timeout: 15_000 })
    .then((r) => {
      setToken(r.data.accessToken);
      return r.data;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { config, response } = error;
    const isAuthCall = config?.url?.startsWith("/auth/");
    if (response?.status === 401 && config && !config._retried && !isAuthCall) {
      config._retried = true;
      try {
        await refreshSession();
        config.headers.Authorization = `Bearer ${accessToken}`;
        return api(config);
      } catch {
        setToken(null);
        window.dispatchEvent(new Event("talk:signed-out"));
      }
    }
    return Promise.reject(error);
  },
);

export const errMsg = (e, fallback = "Something went wrong") =>
  e?.response?.data?.message || (e?.code === "ECONNABORTED" ? "Request timed out" : e?.message === "Network Error" ? "You appear to be offline" : fallback);
