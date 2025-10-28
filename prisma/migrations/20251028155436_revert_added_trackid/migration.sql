/*
  Warnings:

  - A unique constraint covering the columns `[TrackerID]` on the table `Driver_Db` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."AssignedTask_DB" ADD COLUMN     "TrackerID" INTEGER;

-- AlterTable
ALTER TABLE "public"."Driver_Db" ADD COLUMN     "TrackerID" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Driver_Db_TrackerID_key" ON "public"."Driver_Db"("TrackerID");
