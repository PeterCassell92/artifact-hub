-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "conversationFinalMessageAt" TIMESTAMP(3),
ADD COLUMN     "conversationFirstMessageAt" TIMESTAMP(3),
ADD COLUMN     "conversationMessageCount" INTEGER;

-- AlterTable
ALTER TABLE "ArtifactEnrichment" ADD COLUMN     "conversationFinalMessageAt" TIMESTAMP(3),
ADD COLUMN     "conversationFirstMessageAt" TIMESTAMP(3),
ADD COLUMN     "conversationMessageCount" INTEGER;
