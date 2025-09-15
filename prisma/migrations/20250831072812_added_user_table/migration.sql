-- CreateTable
CREATE TABLE "public"."User_Db" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "User_Db_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_Db_username_key" ON "public"."User_Db"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_Db_email_key" ON "public"."User_Db"("email");
