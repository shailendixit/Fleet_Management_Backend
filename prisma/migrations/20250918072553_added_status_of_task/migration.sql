-- CreateEnum
CREATE TYPE "public"."AssignmentStatus" AS ENUM ('created', 'started', 'completed');

-- AlterTable
ALTER TABLE "public"."AssignedTask_DB" ADD COLUMN     "status" "public"."AssignmentStatus" NOT NULL DEFAULT 'created';
