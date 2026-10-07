import { PrismaClient } from "@tradesim/db";
import { SnapshotFlusher } from "./snapshot-flusher";

describe("SnapshotFlusher", () => {
  const createMany = jest.fn();
  const prisma = {
    priceSnapshot: { createMany },
  } as unknown as PrismaClient;

  beforeEach(() => {
    createMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("retains only the latest tick per symbol in each batch", async () => {
    const flusher = new SnapshotFlusher(prisma);
    flusher.retain({
      symbol: "INFY",
      priceCents: 100n,
      ts: "2026-09-13T03:45:00.000Z",
    });
    flusher.retain({
      symbol: "INFY",
      priceCents: 101n,
      ts: "2026-09-13T03:45:01.000Z",
    });
    flusher.retain({
      symbol: "TCS",
      priceCents: 200n,
      ts: "2026-09-13T03:45:01.000Z",
    });

    await expect(flusher.flush()).resolves.toBe(2);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          symbol: "INFY",
          priceCents: 101n,
          ts: new Date("2026-09-13T03:45:01.000Z"),
        },
        {
          symbol: "TCS",
          priceCents: 200n,
          ts: new Date("2026-09-13T03:45:01.000Z"),
        },
      ],
    });
    expect(flusher.bufferedCount).toBe(0);
  });

  it("does not discard a newer tick retained during a database write", async () => {
    const flusher = new SnapshotFlusher(prisma);
    flusher.retain({
      symbol: "INFY",
      priceCents: 100n,
      ts: "2026-09-13T03:45:00.000Z",
    });
    createMany.mockImplementationOnce(async () => {
      flusher.retain({
        symbol: "INFY",
        priceCents: 102n,
        ts: "2026-09-13T03:45:02.000Z",
      });
      return { count: 1 };
    });

    await flusher.flush();
    expect(flusher.bufferedCount).toBe(1);
    await flusher.flush();
    expect(createMany).toHaveBeenLastCalledWith({
      data: [
        {
          symbol: "INFY",
          priceCents: 102n,
          ts: new Date("2026-09-13T03:45:02.000Z"),
        },
      ],
    });
  });
});
