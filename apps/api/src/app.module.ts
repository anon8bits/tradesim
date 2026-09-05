import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health/health.controller";

// Phase 1: just config + a health check, proving the app boots and can talk
// to the database via @tradesim/db. AuthModule, MarketModule,
// PortfolioModule, OrdersModule, RealtimeModule are added in later phases —
// see docs/TASKS.md.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
