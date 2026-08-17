-- AlterTable
ALTER TABLE "ArtifactRelationship" ADD COLUMN     "note" TEXT;

-- AddForeignKey
ALTER TABLE "ArtifactRelationship" ADD CONSTRAINT "ArtifactRelationship_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
