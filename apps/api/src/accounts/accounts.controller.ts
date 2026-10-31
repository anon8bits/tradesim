import {
  Controller,
  Headers,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtPayload } from "../auth/jwt.strategy";
import { AccountsService } from "./accounts.service";
import { AccountResponseDto } from "./dto/account-response.dto";

interface AuthenticatedRequest {
  user: JwtPayload;
}

interface StatusSettableResponse {
  status(code: number): unknown;
}

@Controller("me")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** Idempotent: 201 when the account is created, 200 when it already exists. */
  @Post()
  async ensureAccount(
    @Req() request: AuthenticatedRequest,
    @Headers("authorization") authorization: string | undefined,
    @Res({ passthrough: true }) response: StatusSettableResponse,
  ): Promise<AccountResponseDto> {
    const accessToken = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
    if (!accessToken) {
      throw new UnauthorizedException();
    }
    const { account, created } = await this.accounts.ensureAccount(
      request.user.sub,
      accessToken,
    );
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return new AccountResponseDto(account, created);
  }
}
