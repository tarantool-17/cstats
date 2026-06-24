import type { OutboundMessage } from '../channels/outbound-message.js';
import type { IngestionResult } from './ingestion.service.js';

export function renderIngestionResult(result: IngestionResult): OutboundMessage {
  const imageLines = result.images.map((image, index) => {
    const dbImage = result.database?.images[index];
    const status = image.storage.alreadyExists || dbImage?.imageAssetInserted === false
      ? 'duplicate image; already stored'
      : 'stored';
    const job = dbImage?.extractionJobId ? `, job #${dbImage.extractionJobId} queued` : '';
    const db = dbImage ? `, asset #${dbImage.imageAssetId}${job}` : '';

    return `${index + 1}. ${status}: ${image.storage.relativePath}${db}`;
  });
  const dbLine = result.database
    ? `DB source #${result.database.sourceMessageId}`
    : 'DB disabled; file saved only.';

  return {
    text: [
      'Image received.',
      `Message: ${result.sourceMessage.externalMessageId}`,
      dbLine,
      ...imageLines,
      'Extraction worker will process queued DB jobs.'
    ].join('\n')
  };
}
