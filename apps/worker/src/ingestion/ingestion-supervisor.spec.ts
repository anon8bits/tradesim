import { MarketDataConnection } from "./upstox-client";
import { IngestionSupervisor } from "./ingestion-supervisor";
import { TickDecoder } from "./tick-decoder";

describe("IngestionSupervisor", () => {
  it("reconnects with exponential backoff then uses the rate-limited fallback", async () => {
    const now = new Date("2026-09-14T04:00:00.000Z");
    const calendar = {
      currentSession: jest.fn().mockResolvedValue({
        startMilliseconds: now.getTime() - 1_000,
        endMilliseconds: now.getTime() + 60_000,
      }),
    };
    const close = jest.fn(async () => undefined);
    const connect = jest.fn(
      async (
        _keys: readonly string[],
        _onMessage: (payload: Buffer) => void,
        onClose: (error?: Error) => void,
      ): Promise<MarketDataConnection> => {
        setImmediate(() => onClose(new Error("simulated drop")));
        return { close };
      },
    );
    let fallbackReached: (() => void) | undefined;
    const reachedFallback = new Promise<void>((resolve) => {
      fallbackReached = resolve;
    });
    const fallback = {
      fetchTicks: jest.fn(async () => {
        fallbackReached?.();
        return [
          {
            instrumentKey: "NSE_EQ|TEST",
            priceRupees: 100,
            timestampMilliseconds: now.getTime().toString(),
          },
        ];
      }),
    };
    const handler = { handle: jest.fn(async () => undefined) };
    const waits: number[] = [];
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const supervisor = new IngestionSupervisor(
      calendar,
      { connect },
      fallback,
      new TickDecoder(),
      handler,
      {
        retryBaseMilliseconds: 2,
        retryMaxMilliseconds: 100,
        fallbackAfterFailures: 3,
        fallbackPollMilliseconds: 10,
        closedMarketPollMilliseconds: 10,
        now: () => now,
        onWait: (milliseconds) => waits.push(milliseconds),
      },
    );

    supervisor.start();
    await reachedFallback;
    await supervisor.close();

    expect(connect).toHaveBeenCalledTimes(3);
    expect(waits).toEqual(expect.arrayContaining([2, 4]));
    expect(fallback.fetchTicks).toHaveBeenCalledTimes(1);
    expect(handler.handle).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  describe("closed-market LTP snapshot", () => {
    const now = new Date("2026-10-06T18:00:00.000Z");
    const tick = {
      instrumentKey: "NSE_EQ|TEST",
      priceRupees: 2945.5,
      timestampMilliseconds: now.getTime().toString(),
    };

    function setup(
      sessions: Array<{ startMilliseconds: number; endMilliseconds: number } | null>,
      fetchTicks: jest.Mock,
      stopAfterWaits: number,
    ) {
      let calls = 0;
      const calendar = {
        currentSession: jest.fn(async () => {
          const session = sessions[Math.min(calls, sessions.length - 1)];
          calls += 1;
          return session;
        }),
      };
      const connect = jest.fn(
        async (
          _keys: readonly string[],
          _onMessage: (payload: Buffer) => void,
          onClose: (error?: Error) => void,
        ): Promise<MarketDataConnection> => {
          setImmediate(() => onClose(new Error("simulated drop")));
          return { close: async () => undefined };
        },
      );
      const handler = { handle: jest.fn(async () => undefined) };
      let waits = 0;
      let finished: (() => void) | undefined;
      const done = new Promise<void>((resolve) => {
        finished = resolve;
      });
      const supervisor = new IngestionSupervisor(
        calendar,
        { connect },
        { fetchTicks },
        new TickDecoder(),
        handler,
        {
          retryBaseMilliseconds: 1,
          closedMarketPollMilliseconds: 1,
          now: () => now,
          onWait: () => {
            waits += 1;
            if (waits === stopAfterWaits) finished?.();
          },
        },
      );
      return { supervisor, done, handler, connect };
    }

    beforeEach(() => {
      jest.spyOn(console, "log").mockImplementation(() => undefined);
      jest.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it("loads last traded prices once while the market stays closed", async () => {
      const fetchTicks = jest.fn(async () => [tick]);
      const { supervisor, done, handler, connect } = setup([null], fetchTicks, 4);

      supervisor.start();
      await done;
      await supervisor.close();

      expect(fetchTicks).toHaveBeenCalledTimes(1);
      expect(handler.handle).toHaveBeenCalledWith(tick);
      expect(connect).not.toHaveBeenCalled();
    });

    it("retries a failed snapshot on the next closed-market poll", async () => {
      const fetchTicks = jest
        .fn()
        .mockRejectedValueOnce(new Error("HTTP 503"))
        .mockResolvedValue([tick]);
      const { supervisor, done, handler } = setup([null], fetchTicks, 4);

      supervisor.start();
      await done;
      await supervisor.close();

      expect(fetchTicks).toHaveBeenCalledTimes(2);
      expect(handler.handle).toHaveBeenCalledTimes(1);
    });

    it("takes a fresh snapshot after a trading session", async () => {
      const session = {
        startMilliseconds: now.getTime() - 1_000,
        endMilliseconds: now.getTime() + 60_000,
      };
      const fetchTicks = jest.fn(async () => [tick]);
      const { supervisor, done, connect } = setup(
        [null, session, null],
        fetchTicks,
        4,
      );

      supervisor.start();
      await done;
      await supervisor.close();

      expect(connect).toHaveBeenCalledTimes(1);
      expect(fetchTicks).toHaveBeenCalledTimes(2);
    });
  });
});
