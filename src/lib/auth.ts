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

function getRequestOrigin(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (forwardedProto && host) {
    return `${forwardedProto}://${host}`;
  }

  return (
    request.headers.get("origin") ||
    request.headers.get("referer")?.split("/").slice(0, 3).join("/") ||
    new URL(request.url).origin
  );
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
  headers.set("Origin", getRequestOrigin(request));
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
  headers.set("Origin", getRequestOrigin(request));
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
