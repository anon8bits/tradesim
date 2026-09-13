import { Order, OrderStatus } from "@tradesim/db";

export class OrderResponseDto {
  readonly id: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly status: OrderStatus;
  readonly createdAt: string;

  constructor(order: Order) {
    this.id = order.id;
    this.symbol = order.symbol;
    this.side = order.side;
    this.quantity = order.quantity;
    this.status = order.status;
    this.createdAt = order.createdAt.toISOString();
  }
}
