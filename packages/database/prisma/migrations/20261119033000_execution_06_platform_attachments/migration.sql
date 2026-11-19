-- Platform-global attachments.
--
-- The website CMS belongs to the platform, not to a tenant, so its attachments
-- cannot carry a company id. Making the column nullable lets those rows exist;
-- every tenant-owned row still carries its company id and the existing
-- (companyId, entityType, entityId) index still serves them.

-- DropForeignKey
ALTER TABLE "EntityAttachment" DROP CONSTRAINT IF EXISTS "EntityAttachment_companyId_fkey";

-- AlterTable
ALTER TABLE "EntityAttachment" ALTER COLUMN "companyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "EntityAttachment" ADD CONSTRAINT "EntityAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
-- A platform row has no tenant, so the (companyId, ...) index cannot serve its
-- reads; this one covers both platform and tenant lookups by record.
CREATE INDEX IF NOT EXISTS "EntityAttachment_entityType_entityId_idx" ON "EntityAttachment"("entityType", "entityId");
