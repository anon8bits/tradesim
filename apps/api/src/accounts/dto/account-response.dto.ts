import { User } from "@tradesim/db";

export class AccountResponseDto {
  readonly id: string;
  readonly email: string;
  readonly cashBalanceCents: string;
  readonly createdAt: string;
  readonly created: boolean;

  constructor(account: User, created: boolean) {
    this.id = account.id;
    this.email = account.email;
    this.cashBalanceCents = account.cashBalanceCents.toString();
    this.createdAt = account.createdAt.toISOString();
    this.created = created;
  }
}
