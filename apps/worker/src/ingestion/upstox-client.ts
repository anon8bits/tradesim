import { randomUUID } from "node:crypto";
import WebSocket, { RawData } from "ws";

const AUTHORIZE_URL =
  "https://api.upstox.com/v3/feed/market-data-feed/authorize";

export type HttpFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface MarketDataConnection {
  close(): Promise<void>;
}

interface AuthorizationResponse {
  status: string;
  data: {
    authorized_redirect_uri: string;
  };
}

function isAllowedWebSocketUri(value: string): boolean {
  try {
    const uri = new URL(value);
    return (
      uri.protocol === "wss:" ||
      (uri.protocol === "ws:" &&
        (uri.hostname === "127.0.0.1" || uri.hostname === "localhost"))
    );
  } catch {
    return false;
  }
}

function parseAuthorization(value: unknown): AuthorizationResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    value.status !== "success" ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null ||
    !("authorized_redirect_uri" in value.data) ||
    typeof value.data.authorized_redirect_uri !== "string" ||
    !isAllowedWebSocketUri(value.data.authorized_redirect_uri)
  ) {
    throw new Error("Upstox authorize response did not contain a WSS URL");
  }
  return value as AuthorizationResponse;
}

export class UpstoxClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: HttpFetch = fetch,
    private readonly authorizeUrl = AUTHORIZE_URL,
  ) {}

  async connect(
    instrumentKeys: readonly string[],
    onMessage: (payload: Buffer) => void,
    onClose: (error?: Error) => void,
  ): Promise<MarketDataConnection> {
    const uri = await this.authorize();
    const socket = new WebSocket(uri);
    socket.on("message", (data: RawData) => {
      const payload = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      onMessage(payload);
    });

    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => reject(error);
      socket.once("error", handleError);
      socket.once("open", () => {
        socket.off("error", handleError);
        const request = {
          guid: randomUUID(),
          method: "sub",
          data: {
            mode: "ltpc",
            instrumentKeys,
          },
        };
        socket.send(Buffer.from(JSON.stringify(request)));
        resolve();
      });
    });

    let closedByClient = false;
    socket.on("error", (error) => {
      if (!closedByClient) {
        onClose(error);
      }
    });
    socket.on("close", () => {
      if (!closedByClient) {
        onClose();
      }
    });

    return {
      close: () =>
        new Promise<void>((resolve) => {
          closedByClient = true;
          if (
            socket.readyState === WebSocket.CLOSED ||
            socket.readyState === WebSocket.CLOSING
          ) {
            resolve();
            return;
          }
          socket.once("close", () => resolve());
          socket.close();
        }),
    };
  }

  private async authorize(): Promise<string> {
    const response = await this.fetchFn(this.authorizeUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Upstox authorize failed with HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    return parseAuthorization(body).data.authorized_redirect_uri;
  }
}

export function requireAnalyticsToken(value: string | undefined): string {
  const token = value?.trim();
  if (!token || token.length < 20 || /\s/.test(token)) {
    throw new Error("UPSTOX_ANALYTICS_TOKEN is missing or malformed");
  }
  return token;
}
