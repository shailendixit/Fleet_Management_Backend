/*
  Warnings:

  - The `status` column on the `AssignedTask_DB` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "public"."AssignedTask_DB" DROP COLUMN "status",
ADD COLUMN     "status" TEXT DEFAULT 'Not Started';

-- DropEnum
DROP TYPE "public"."AssignmentStatus";
