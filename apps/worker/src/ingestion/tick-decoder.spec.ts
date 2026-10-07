import { CURATED_INSTRUMENT_KEYS } from "@tradesim/common";
import { parse } from "protobufjs";
import { MARKET_DATA_PROTO, TickDecoder } from "./tick-decoder";

describe("TickDecoder", () => {
  const root = parse(MARKET_DATA_PROTO).root;
  const feedResponse = root.lookupType(
    "com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse",
  );

  it("decodes LTPC initial and live feed payloads", () => {
    const instrumentKey = CURATED_INSTRUMENT_KEYS[0];
    const timestamp = "1789290900000";
    const payload = feedResponse
      .encode(
        feedResponse.create({
          type: "live_feed",
          currentTs: "1789290900123",
          feeds: {
            [instrumentKey]: {
              ltpc: {
                ltp: 1234.55,
                ltt: timestamp,
                ltq: "10",
                cp: 1200,
              },
              requestMode: "ltpc",
            },
          },
        }),
      )
      .finish();

    expect(new TickDecoder(root).decode(Buffer.from(payload))).toEqual([
      {
        instrumentKey,
        priceRupees: 1234.55,
        timestampMilliseconds: timestamp,
      },
    ]);
  });

  it("ignores market-info messages that contain no prices", () => {
    const payload = feedResponse
      .encode(
        feedResponse.create({
          type: "market_info",
          currentTs: "1789290900123",
          marketInfo: { segmentStatus: { NSE_EQ: "NORMAL_OPEN" } },
        }),
      )
      .finish();

    expect(new TickDecoder(root).decode(Buffer.from(payload))).toEqual([]);
  });
});
