import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { STARTING_CASH_BALANCE_PAISE } from "@tradesim/common";
import { Prisma, User } from "@tradesim/db";
import { PrismaService } from "../prisma/prisma.service";
import { Auth0UserInfoService } from "./auth0-user-info.service";

export const OPENING_DEPOSIT_TRANSACTION_TYPE = "DEPOSIT";

export interface EnsuredAccount {
  account: User;
  created: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  "google-oauth2": "Google",
  auth0: "email and password",
};

export function signInMethodLabel(auth0Id: string): string {
  const provider = auth0Id.split("|")[0];
  return PROVIDER_LABELS[provider] ?? "a different sign-in method";
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userInfo: Auth0UserInfoService,
  ) {}

  /**
   * Returns the caller's trading account, creating it on first use. One
   * Auth0 identity owns at most one account (`auth0Id` is unique) and one
   * email backs at most one account (`email` is unique), so a second login
   * method with the same email is refused rather than given a second wallet.
   */
  async ensureAccount(
    auth0Id: string,
    accessToken: string,
  ): Promise<EnsuredAccount> {
    const existing = await this.prisma.user.findUnique({ where: { auth0Id } });
    if (existing) {
      return { account: existing, created: false };
    }

    const identity = await this.userInfo.fetchIdentity(accessToken);
    if (identity.sub !== auth0Id) {
      throw new UnauthorizedException(
        "Your login could not be verified. Sign out and sign in again.",
      );
    }
    if (!identity.email) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "EMAIL_MISSING",
        message:
          "Your login does not share an email address, which TradeSim needs to open a trading account.",
      });
    }
    if (!identity.emailVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "Forbidden",
        code: "EMAIL_NOT_VERIFIED",
        message: `Verify ${identity.email} using the link Auth0 emailed you, then try again.`,
      });
    }

    const email = identity.email;
    await this.assertEmailAvailable(email);

    try {
      const account = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            auth0Id,
            email,
            cashBalanceCents: STARTING_CASH_BALANCE_PAISE,
          },
        });
        await tx.transaction.create({
          data: {
            userId: user.id,
            type: OPENING_DEPOSIT_TRANSACTION_TYPE,
            amountCents: STARTING_CASH_BALANCE_PAISE,
          },
        });
        return user;
      });
      return { account, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // A concurrent first request for the same login won the insert.
      const raced = await this.prisma.user.findUnique({ where: { auth0Id } });
      if (raced) {
        return { account: raced, created: false };
      }
      await this.assertEmailAvailable(email);
      throw error;
    }
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const owner = await this.prisma.user.findUnique({
      where: { email },
      select: { auth0Id: true },
    });
    if (!owner) {
      return;
    }
    const method = signInMethodLabel(owner.auth0Id);
    throw new ConflictException({
      statusCode: 409,
      error: "Conflict",
      code: "EMAIL_IN_USE",
      message: `${email} is already in use by a TradeSim account that signs in with ${method}. Sign out and continue with ${method} instead.`,
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
