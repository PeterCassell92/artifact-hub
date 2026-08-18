-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "EnrichmentSource" AS ENUM ('human', 'ai');

-- AlterEnum
ALTER TYPE "AccessRoute" ADD VALUE 'system';

-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "aiTopics" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ArtifactRelationship" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "source" "EnrichmentSource" NOT NULL DEFAULT 'human';

-- AlterTable
ALTER TABLE "ArtifactTag" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "source" "EnrichmentSource" NOT NULL DEFAULT 'human';

-- CreateTable
CREATE TABLE "ArtifactEnrichment" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "status" "EnrichmentStatus" NOT NULL DEFAULT 'pending',
    "trigger" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "summary" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tagsAdded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relationshipsProposed" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactEnrichment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtifactEnrichment_artifactId_createdAt_idx" ON "ArtifactEnrichment"("artifactId", "createdAt");

-- AddForeignKey
ALTER TABLE "ArtifactEnrichment" ADD CONSTRAINT "ArtifactEnrichment_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactEnrichment" ADD CONSTRAINT "ArtifactEnrichment_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
