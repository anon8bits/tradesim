import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { OrderSide } from "@tradesim/db";
import { CreateOrderDto } from "./create-order.dto";

describe("CreateOrderDto", () => {
  it("normalizes and accepts a valid order", async () => {
    const dto = plainToInstance(CreateOrderDto, {
      symbol: " tcs ",
      side: OrderSide.BUY,
      quantity: 2,
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.symbol).toBe("TCS");
  });

  it.each([
    { symbol: "", side: OrderSide.BUY, quantity: 1 },
    { symbol: "TCS", side: "HOLD", quantity: 1 },
    { symbol: "TCS", side: OrderSide.SELL, quantity: 0 },
    { symbol: "TCS", side: OrderSide.SELL, quantity: 1.5 },
  ])("rejects invalid order input %#", async (value) => {
    const errors = await validate(plainToInstance(CreateOrderDto, value));
    expect(errors.length).toBeGreaterThan(0);
  });
});
