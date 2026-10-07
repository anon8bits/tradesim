import { parse, Root, Type } from "protobufjs";

// Official Upstox Market Data Feed V3 schema:
// https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto
export const MARKET_DATA_PROTO = `
syntax = "proto3";
package com.upstox.marketdatafeederv3udapi.rpc.proto;

message LTPC {
  double ltp = 1;
  int64 ltt = 2;
  int64 ltq = 3;
  double cp = 4;
}
message MarketLevel { repeated Quote bidAskQuote = 1; }
message MarketOHLC { repeated OHLC ohlc = 1; }
message Quote {
  int64 bidQ = 1;
  double bidP = 2;
  int64 askQ = 3;
  double askP = 4;
}
message OptionGreeks {
  double delta = 1;
  double theta = 2;
  double gamma = 3;
  double vega = 4;
  double rho = 5;
}
message OHLC {
  string interval = 1;
  double open = 2;
  double high = 3;
  double low = 4;
  double close = 5;
  int64 vol = 6;
  int64 ts = 7;
}
enum Type {
  initial_feed = 0;
  live_feed = 1;
  market_info = 2;
}
message MarketFullFeed {
  LTPC ltpc = 1;
  MarketLevel marketLevel = 2;
  OptionGreeks optionGreeks = 3;
  MarketOHLC marketOHLC = 4;
  double atp = 5;
  int64 vtt = 6;
  double oi = 7;
  double iv = 8;
  double tbq = 9;
  double tsq = 10;
}
message IndexFullFeed {
  LTPC ltpc = 1;
  MarketOHLC marketOHLC = 2;
}
message FullFeed {
  oneof FullFeedUnion {
    MarketFullFeed marketFF = 1;
    IndexFullFeed indexFF = 2;
  }
}
message FirstLevelWithGreeks {
  LTPC ltpc = 1;
  Quote firstDepth = 2;
  OptionGreeks optionGreeks = 3;
  int64 vtt = 4;
  double oi = 5;
  double iv = 6;
}
message Feed {
  oneof FeedUnion {
    LTPC ltpc = 1;
    FullFeed fullFeed = 2;
    FirstLevelWithGreeks firstLevelWithGreeks = 3;
  }
  RequestMode requestMode = 4;
}
enum RequestMode {
  ltpc = 0;
  full_d5 = 1;
  option_greeks = 2;
  full_d30 = 3;
}
enum MarketStatus {
  PRE_OPEN_START = 0;
  PRE_OPEN_END = 1;
  NORMAL_OPEN = 2;
  NORMAL_CLOSE = 3;
  CLOSING_START = 4;
  CLOSING_END = 5;
}
message MarketInfo { map<string, MarketStatus> segmentStatus = 1; }
message FeedResponse {
  Type type = 1;
  map<string, Feed> feeds = 2;
  int64 currentTs = 3;
  MarketInfo marketInfo = 4;
}
`;

export interface DecodedPrice {
  instrumentKey: string;
  priceRupees: number;
  timestampMilliseconds: string;
}

interface ObjectRecord {
  [key: string]: unknown;
}

function asRecord(value: unknown): ObjectRecord | null {
  return typeof value === "object" && value !== null
    ? (value as ObjectRecord)
    : null;
}

export class TickDecoder {
  private readonly feedResponse: Type;

  constructor(root: Root = parse(MARKET_DATA_PROTO).root) {
    this.feedResponse = root.lookupType(
      "com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse",
    );
  }

  decode(payload: Buffer): DecodedPrice[] {
    const message = this.feedResponse.decode(payload);
    const decoded = asRecord(
      this.feedResponse.toObject(message, {
        longs: String,
        enums: String,
      }),
    );
    const feeds = asRecord(decoded?.feeds);
    if (!feeds) {
      return [];
    }

    const currentTs =
      typeof decoded?.currentTs === "string" ? decoded.currentTs : "0";
    const ticks: DecodedPrice[] = [];
    for (const [instrumentKey, rawFeed] of Object.entries(feeds)) {
      const feed = asRecord(rawFeed);
      const ltpc =
        asRecord(feed?.ltpc) ??
        asRecord(asRecord(asRecord(feed?.fullFeed)?.marketFF)?.ltpc) ??
        asRecord(
          asRecord(asRecord(feed?.firstLevelWithGreeks))?.ltpc,
        );
      if (!ltpc || typeof ltpc.ltp !== "number" || ltpc.ltp <= 0) {
        continue;
      }

      const ltt =
        typeof ltpc.ltt === "string" && ltpc.ltt !== "0"
          ? ltpc.ltt
          : currentTs;
      if (!/^\d+$/.test(ltt) || ltt === "0") {
        continue;
      }
      ticks.push({
        instrumentKey,
        priceRupees: ltpc.ltp,
        timestampMilliseconds: ltt,
      });
    }
    return ticks;
  }
}
