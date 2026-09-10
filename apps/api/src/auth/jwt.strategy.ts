import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { passportJwtSecret } from "jwks-rsa";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface JwtPayload {
  sub: string;
  permissions?: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const configuredDomain = config.getOrThrow<string>("AUTH0_DOMAIN");
    const domain = configuredDomain
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const audience = config.getOrThrow<string>("AUTH0_AUDIENCE");
    const issuer = `https://${domain}/`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience,
      issuer,
      algorithms: ["RS256"],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${issuer}.well-known/jwks.json`,
      }),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
