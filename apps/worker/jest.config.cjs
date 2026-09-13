/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.spec.ts"],
  moduleNameMapper: {
    "^@tradesim/db$": "<rootDir>/../../libs/db/src/index.ts",
    "^@tradesim/common$": "<rootDir>/../../libs/common/src/index.ts",
  },
};
