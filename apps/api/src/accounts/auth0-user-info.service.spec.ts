import {
  BadGatewayException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Auth0UserInfoService } from "./auth0-user-info.service";

describe("Auth0UserInfoService", () => {
  const config = {
    getOrThrow: () => "https://tenant.example.auth0.com/",
  } as unknown as ConfigService;
  const service = new Auth0UserInfoService(config);
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const respond = (status: number, body: unknown = {}) =>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    );

  it("reads the normalized email and verification flag with the caller's token", async () => {
    respond(200, {
      sub: "google-oauth2|1",
      email: "  Asha@Example.COM ",
      email_verified: true,
    });

    await expect(service.fetchIdentity("token-1")).resolves.toEqual({
      sub: "google-oauth2|1",
      email: "asha@example.com",
      emailVerified: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://tenant.example.auth0.com/userinfo",
      { headers: { Authorization: "Bearer token-1" } },
    );
  });

  it("treats a missing verification flag as unverified and a blank email as missing", async () => {
    respond(200, { sub: "auth0|1", email: " " });

    await expect(service.fetchIdentity("t")).resolves.toEqual({
      sub: "auth0|1",
      email: null,
      emailVerified: false,
    });
  });

  it("maps provider failures to explicit errors", async () => {
    respond(401);
    await expect(service.fetchIdentity("t")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    respond(429);
    await expect(service.fetchIdentity("t")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    respond(500);
    await expect(service.fetchIdentity("t")).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    respond(200, { email: "a@b.c" });
    await expect(service.fetchIdentity("t")).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    fetchMock.mockRejectedValue(new TypeError("network down"));
    await expect(service.fetchIdentity("t")).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});
