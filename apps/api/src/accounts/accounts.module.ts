import { Module } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { Auth0UserInfoService } from "./auth0-user-info.service";

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, Auth0UserInfoService],
})
export class AccountsModule {}
