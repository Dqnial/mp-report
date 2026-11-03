-- CreateTable
CREATE TABLE "plan_dismissals" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "fullName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_dismissals_userId_date_fullName_key" ON "plan_dismissals"("userId", "date", "fullName");

-- AddForeignKey
ALTER TABLE "plan_dismissals" ADD CONSTRAINT "plan_dismissals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
