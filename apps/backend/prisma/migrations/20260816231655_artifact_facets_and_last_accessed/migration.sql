-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "lastAccessedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Artifact_contentType_idx" ON "Artifact"("contentType");

-- CreateIndex
CREATE INDEX "Artifact_lastAccessedAt_idx" ON "Artifact"("lastAccessedAt");

-- CreateIndex
CREATE INDEX "ArtifactTag_tagId_idx" ON "ArtifactTag"("tagId");
