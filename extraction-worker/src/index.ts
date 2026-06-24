import { createWorkerConfig } from './config.js';
import { ExtractionJobRepository } from './extraction-job.repository.js';
import { ExtractionWorker } from './extraction-worker.js';

const config = createWorkerConfig(process.env);
const repository = new ExtractionJobRepository(config.databaseUrl);
const worker = new ExtractionWorker(config, repository);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, stopping extraction worker`);
    worker.stop();
  });
}

await worker.start();
await repository.close();
