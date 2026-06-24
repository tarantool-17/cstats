import type { NormalizedMessage } from '../channels/normalized-message.js';
import type { IngestedImage } from './ingestion.service.js';

export type DatabaseImageIngestion = {
  imageAssetId: number;
  imageAssetInserted: boolean;
  extractionJobId?: number;
};

export type DatabaseIngestionResult = {
  sourceMessageId: number;
  sourceMessageInserted: boolean;
  images: DatabaseImageIngestion[];
};

export interface IngestionRepository {
  recordImageMessage(
    message: NormalizedMessage,
    images: IngestedImage[]
  ): Promise<DatabaseIngestionResult>;
}
