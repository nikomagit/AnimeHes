import {
  AppError,
  UpstreamHttpError,
  UpstreamNetworkError,
  UpstreamPayloadError,
  UpstreamTimeoutError,
} from "../errors.js";

export interface FetchTextOptions {
  timeoutMs: number;
  maxBytes: number;
  upstream: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}

export type FetchText = (
  url: URL | string,
  options: FetchTextOptions,
) => Promise<string>;

export const fetchText: FetchText = async (url, options) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      redirect: "follow",
      signal: controller.signal,
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.body === undefined ? {} : { body: options.body }),
    });
    if (!response.ok) throw new UpstreamHttpError(options.upstream, response.status);

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
      throw new UpstreamPayloadError(options.upstream, "response is too large");
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > options.maxBytes) {
      throw new UpstreamPayloadError(options.upstream, "response is too large");
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new UpstreamTimeoutError(options.upstream);
    if (error instanceof AppError) throw error;
    throw new UpstreamNetworkError(options.upstream);
  } finally {
    clearTimeout(timer);
  }
};
