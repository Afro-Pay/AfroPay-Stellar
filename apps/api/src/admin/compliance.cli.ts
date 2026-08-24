import { NestFactory } from '@nestjs/core';
import { AdminModule } from './admin.module';
import { AdminComplianceService } from './admin.service';

async function main() {
  const [operation, userId, adminUserId] = process.argv.slice(2);
  if (!['erase', 'sar-export'].includes(operation) || !userId || !adminUserId) {
    throw new Error('Usage: compliance <erase|sar-export> <user-id> <admin-user-id>');
  }

  const app = await NestFactory.createApplicationContext(AdminModule, { logger: false });
  try {
    const service = app.get(AdminComplianceService);
    const result = operation === 'erase'
      ? await service.eraseUser(userId, adminUserId)
      : await service.exportSar(userId, adminUserId);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
