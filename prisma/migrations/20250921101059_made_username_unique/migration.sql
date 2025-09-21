/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `Driver_Db` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Driver_Db_username_key" ON "public"."Driver_Db"("username");
