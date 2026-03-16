import { env } from "../env.js";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
};

export type AuthSession = {
  user: AuthUser;
  session: {
    id: string;
    expiresAt?: string;
  };
};

function authUrl(path: string) {
  if (!env.NEON_AUTH_BASE_URL) {
    throw new Error("NEON_AUTH_BASE_URL is not configured.");
  }

  return new URL(path.replace(/^\//, ""), `${env.NEON_AUTH_BASE_URL.replace(/\/$/, "")}/`);
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const isDefaultPort =
      (url.protocol === "https:" && (url.port === "" || url.port === "443")) ||
      (url.protocol === "http:" && (url.port === "" || url.port === "80"));
    const host = isDefaultPort ? url.hostname : `${url.hostname}:${url.port}`;
    return `${url.protocol}//${host}`;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }

  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function normalizeAuthOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" && !isLocalHostname(url.hostname)) {
      url.protocol = "https:";
      if (url.port === "80") {
        url.port = "";
      }
    }
    return normalizeOrigin(url.toString());
  } catch {
    return normalizeOrigin(value);
  }
}

export function resolveRequestOrigin(request: Request): string {
  const explicitOrigin = request.headers.get("origin");
  if (explicitOrigin) {
    const normalized = normalizeAuthOrigin(explicitOrigin);
    if (normalized) {
      return normalized;
    }
  }

  const forwardedProtoHeader = request.headers.get("x-forwarded-proto");
  const forwardedProto = forwardedProtoHeader?.split(",")[0]?.trim();
  const forwardedHostHeader = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (forwardedProto && forwardedHostHeader) {
    const firstHost = forwardedHostHeader.split(",")[0]?.trim();
    if (firstHost) {
      const normalized = normalizeOrigin(`${forwardedProto}://${firstHost}`);
      if (normalized) {
        return normalized;
      }
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    const normalized = normalizeAuthOrigin(referer);
    if (normalized) {
      return normalized;
    }
  }

  if (forwardedHostHeader) {
    const firstHost = forwardedHostHeader.split(",")[0]?.trim();
    if (firstHost) {
      const hostOnly = firstHost.split(":")[0] ?? firstHost;
      const localhostLike =
        hostOnly === "localhost" ||
        hostOnly === "127.0.0.1" ||
        hostOnly === "::1" ||
        hostOnly.endsWith(".local");
      const assumedProto = localhostLike ? "http" : "https";
      const normalized = normalizeAuthOrigin(`${assumedProto}://${firstHost}`);
      if (normalized) {
        return normalized;
      }
    }
  }

  return normalizeAuthOrigin(new URL(request.url).origin) ?? new URL(request.url).origin;
}

function extractNeonAuthCookies(cookieHeader: string | null) {
  if (!cookieHeader) {
    return "";
  }

  return cookieHeader
    .split(";")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("__Secure-neon-auth"))
    .join("; ");
}

function copySetCookieHeaders(source: Headers, target: Headers) {
  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;

  if (typeof getSetCookie === "function") {
    for (const cookie of getSetCookie.call(source)) {
      target.append("set-cookie", cookie);
    }
    return;
  }

  const singleCookie = source.get("set-cookie");
  if (singleCookie) {
    target.append("set-cookie", singleCookie);
  }
}

function copyResponseHeaders(source: Headers, target: Headers) {
  for (const [key, value] of source.entries()) {
    if (key.toLowerCase() === "set-cookie") {
      continue;
    }
    target.set(key, value);
  }
}

export async function proxyAuthRequest(request: Request, path: string) {
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  const headers = new Headers();
  for (const headerName of ["user-agent", "authorization", "referer", "content-type"]) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }
  headers.set("Origin", resolveRequestOrigin(request));
  headers.set("Cookie", extractNeonAuthCookies(request.headers.get("cookie")));
  headers.set("X-Neon-Auth-Next-Middleware", "true");

  const upstream = await fetch(authUrl(path), {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  copyResponseHeaders(upstream.headers, responseHeaders);
  copySetCookieHeaders(upstream.headers, responseHeaders);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function authJson(request: Request, path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("Origin", resolveRequestOrigin(request));
  headers.set("Cookie", extractNeonAuthCookies(request.headers.get("cookie")));
  headers.set("X-Neon-Auth-Next-Middleware", "true");
  const userAgent = request.headers.get("user-agent");
  if (userAgent) {
    headers.set("user-agent", userAgent);
  }
  const referer = request.headers.get("referer");
  if (referer) {
    headers.set("referer", referer);
  }

  const response = await fetch(authUrl(path), {
    ...options,
    headers,
    redirect: "manual",
  });

  return response;
}

export async function getAuthSession(headers: Headers): Promise<AuthSession | null> {
  if (!env.NEON_AUTH_BASE_URL) {
    return null;
  }

  const response = await fetch(authUrl("/get-session"), {
    method: "GET",
    headers: {
      Cookie: extractNeonAuthCookies(headers.get("cookie")),
    },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as AuthSession | null;
  return data?.user?.id ? data : null;
}

export function setAuthCookies(fromResponse: Response, intoHeaders: Headers) {
  copySetCookieHeaders(fromResponse.headers, intoHeaders);
}
