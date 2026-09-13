import { Body, Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { JwtPayload } from "../auth/jwt.strategy";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrderResponseDto } from "./dto/order-response.dto";
import { OrdersService } from "./orders.service";

interface AuthenticatedRequest {
  user: JwtPayload;
}

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    const order = await this.orders.create(request.user.sub, body);
    return new OrderResponseDto(order);
  }
}
