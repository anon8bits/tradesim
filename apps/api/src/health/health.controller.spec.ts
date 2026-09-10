import { PrismaService } from "../prisma/prisma.service";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  const userCount = jest.fn();
  const prisma = {
    user: { count: userCount },
  } as unknown as PrismaService;

  beforeEach(() => {
    userCount.mockReset();
  });

  it("reports database connectivity and the current user count", async () => {
    userCount.mockResolvedValue(2);

    await expect(new HealthController(prisma).check()).resolves.toEqual({
      status: "ok",
      userCount: 2,
    });
    expect(userCount).toHaveBeenCalledTimes(1);
  });
});
