import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    // Deliberately queries the DB, not just returns a static object — this
    // is what proves the monorepo wiring (api -> @tradesim/db -> Postgres)
    // actually works, not just that the process boots.
    const userCount = await this.prisma.user.count();
    return { status: "ok", userCount };
  }
}
