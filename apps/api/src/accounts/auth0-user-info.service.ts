import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface VerifiedIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

interface UserInfoBody {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

/**
 * Access tokens for the TradeSim API carry only `sub`, so the email used for
 * account provisioning is read from Auth0's /userinfo with the caller's own
 * token. Auth0 issues tokens requested with `openid` for both the API and
 * /userinfo audiences, so no extra credentials are needed.
 */
@Injectable()
export class Auth0UserInfoService {
  private readonly userInfoUrl: string;

  constructor(config: ConfigService) {
    const domain = config
      .getOrThrow<string>("AUTH0_DOMAIN")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    this.userInfoUrl = `https://${domain}/userinfo`;
  }

  async fetchIdentity(accessToken: string): Promise<VerifiedIdentity> {
    let response: Response;
    try {
      response = await fetch(this.userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new BadGatewayException("Could not reach the identity provider");
    }

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException(
        "Your login could not be verified. Sign out and sign in again.",
      );
    }
    if (response.status === 429) {
      throw new ServiceUnavailableException(
        "The identity provider is busy. Try again in a minute.",
      );
    }
    if (!response.ok) {
      throw new BadGatewayException("The identity provider returned an error");
    }

    const body = (await response.json()) as UserInfoBody;
    if (typeof body.sub !== "string") {
      throw new BadGatewayException(
        "The identity provider returned an invalid profile",
      );
    }
    return {
      sub: body.sub,
      email:
        typeof body.email === "string" && body.email.trim() !== ""
          ? body.email.trim().toLowerCase()
          : null,
      emailVerified: body.email_verified === true,
    };
  }
}
