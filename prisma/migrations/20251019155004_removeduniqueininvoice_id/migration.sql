-- DropIndex
DROP INDEX "public"."CompletedTask_DB_invoiceId_key";

-- AlterTable
ALTER TABLE "public"."AssignedTask_DB" ADD COLUMN     "isAttemptedToComplete" BOOLEAN NOT NULL DEFAULT false;
