process.env.NETLIFY_SERVERLESS = "true";

interface HandlerEvent {
  rawUrl?: string;
  rawQuery?: string;
  path: string;
  httpMethod: string;
  headers: Record<string, string | undefined>;
  multiValueHeaders?: Record<string, string[]>;
  queryStringParameters?: Record<string, string | undefined> | null;
  multiValueQueryStringParameters?: Record<string, string[]> | null;
  body: string | null;
  isBase64Encoded: boolean;
}

interface HandlerContext {
  callbackWaitsForEmptyEventLoop: boolean;
  [key: string]: any;
}

type Handler = (event: HandlerEvent, context: HandlerContext) => Promise<any>;

let cachedHandler: Handler | null = null;

function normalizeEventPath(event: any): void {
  if (typeof event?.rawUrl === "string" && event.rawUrl.length > 0) {
    try {
      const parsed = new URL(event.rawUrl);
      if (
        parsed.pathname.startsWith("/api/") ||
        parsed.pathname === "/api" ||
        parsed.pathname.startsWith("/uploads/") ||
        parsed.pathname === "/health" ||
        parsed.pathname === "/ready"
      ) {
        event.path = parsed.pathname;
        return;
      }
    } catch {
      // Fallback to event.path normalization below
    }
  }

  if (typeof event?.path === "string") {
    let normalized = event.path.replace(/^\/\.netlify\/functions\/api/, "");
    if (!normalized.startsWith("/")) {
      normalized = "/" + normalized;
    }
    if (
      !normalized.startsWith("/api/") &&
      normalized !== "/api" &&
      !normalized.startsWith("/uploads/") &&
      normalized !== "/health" &&
      normalized !== "/ready"
    ) {
      normalized = "/api" + (normalized === "/" ? "" : normalized);
    }
    event.path = normalized;
  }
}

async function getServerlessHandler() {
  if (cachedHandler) return cachedHandler;

  const [{ default: serverless }, { app, ensureAppInitialized }] = await Promise.all([
    import("serverless-http"),
    import("../../server.js")
  ]);

  await ensureAppInitialized();

  const slsHandler = serverless(app, {
    binary: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/pdf",
      "application/octet-stream",
      "image/*"
    ]
  });

  cachedHandler = async (event: HandlerEvent, context: HandlerContext) => {
    context.callbackWaitsForEmptyEventLoop = false;
    normalizeEventPath(event);
    return slsHandler(event, context);
  };

  return cachedHandler;
}

export const handler: Handler = async (event, context) => {
  try {
    const fn = await getServerlessHandler();
    return await fn(event, context);
  } catch (err: any) {
    console.error("[Netlify Function] Unhandled initialization/handler error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: err?.message || "Backend service initialization failed."
      })
    };
  }
};
