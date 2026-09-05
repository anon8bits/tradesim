import { Controller, Get } from "@nestjs/common";
import { prisma } from "@tradesim/db";

@Controller("health")
export class HealthController {
  @Get()
  async check() {
    // Deliberately queries the DB, not just returns a static object — this
    // is what proves the monorepo wiring (api -> @tradesim/db -> Postgres)
    // actually works, not just that the process boots.
    const userCount = await prisma.user.count();
    return { status: "ok", userCount };
  }
}
