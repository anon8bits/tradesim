import { Controller, Get, Req } from "@nestjs/common";
import { JwtPayload } from "../auth/jwt.strategy";
import { PortfolioResponseDto } from "./dto/portfolio-response.dto";
import { PortfolioService } from "./portfolio.service";

interface AuthenticatedRequest {
  user: JwtPayload;
}

@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  async getPortfolio(
    @Req() request: AuthenticatedRequest,
  ): Promise<PortfolioResponseDto> {
    const portfolio = await this.portfolio.getPortfolio(request.user.sub);
    return new PortfolioResponseDto(portfolio);
  }
}
