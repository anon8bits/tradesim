import { CURATED_INSTRUMENT_KEYS } from "@tradesim/common";
import { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { HttpFetch, UpstoxClient } from "./upstox-client";

describe("UpstoxClient", () => {
  let server: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const client of server.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("authorizes every connection and sends a binary LTPC subscription", async () => {
    const fetchFn = jest.fn(async () =>
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            authorized_redirect_uri: `ws://127.0.0.1:${port}`,
          },
        }),
        { status: 200 },
      ),
    );
    const subscriptions: Array<{ request: unknown; isBinary: boolean }> = [];
    server.on("connection", (socket: WebSocket) => {
      socket.once("message", (data, isBinary) => {
        subscriptions.push({
          request: JSON.parse(data.toString()) as unknown,
          isBinary,
        });
        socket.send(Buffer.from([1, 2, 3]));
      });
    });

    const client = new UpstoxClient(
      "test-analytics-token-with-safe-length",
      fetchFn,
      "https://authorize.test",
    );
    const received = new Promise<Buffer>((resolve) => {
      void client
        .connect(CURATED_INSTRUMENT_KEYS, resolve, () => undefined)
        .then(async (connection) => {
          await new Promise((messageSent) => setImmediate(messageSent));
          await connection.close();
        });
    });

    await expect(received).resolves.toEqual(Buffer.from([1, 2, 3]));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      isBinary: true,
      request: {
        method: "sub",
        data: {
          mode: "ltpc",
          instrumentKeys: CURATED_INSTRUMENT_KEYS,
        },
      },
    });
  });

  it("reports a simulated server-side drop", async () => {
    const fetchFn: HttpFetch = async () =>
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            authorized_redirect_uri: `ws://127.0.0.1:${port}`,
          },
        }),
      );
    server.once("connection", (socket) => {
      socket.once("message", () => socket.terminate());
    });

    const dropped = new Promise<void>((resolve) => {
      void new UpstoxClient(
        "test-analytics-token-with-safe-length",
        fetchFn,
      ).connect(CURATED_INSTRUMENT_KEYS, () => undefined, () => resolve());
    });

    await expect(dropped).resolves.toBeUndefined();
  });
});
