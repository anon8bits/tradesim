import { Transform, TransformFnParams } from "class-transformer";
import { IsEnum, IsInt, Matches, Max, Min } from "class-validator";
import { OrderSide } from "@tradesim/db";

export class CreateOrderDto {
  @Transform(({ value }: TransformFnParams) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9][A-Z0-9._-]{0,19}$/)
  symbol!: string;

  @IsEnum(OrderSide)
  side!: OrderSide;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
}
