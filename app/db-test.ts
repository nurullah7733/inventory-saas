import "dotenv/config";
import { db } from "../prisma/db";

async function main() {
  const user = await db.orm.public.User.create({
    email: `test-${Date.now()}@example.com`,
  });
  console.log("Created:", user);

  const users = await db.orm.public.User.select("id", "email").all();
  console.log("All users:", users);

  await db.close();
}

main();
