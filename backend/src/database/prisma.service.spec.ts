import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { adapterUrls, disconnect } = vi.hoisted(() => ({
  adapterUrls: [] as string[],
  disconnect: vi.fn(),
}));

vi.mock('@prisma/adapter-better-sqlite3', () => ({
  PrismaBetterSqlite3: class {
    constructor({ url }: { url: string }) {
      adapterUrls.push(url);
    }
  },
}));

vi.mock('../generated/prisma/client.js', () => ({
  PrismaClient: class {
    $disconnect = disconnect;
  },
}));

const { PrismaService } = await import('./prisma.service.js');

const PRISMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma');

describe('PrismaService', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    adapterUrls.length = 0;
    disconnect.mockClear();
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalUrl;
  });

  function adapterUrlFor(databaseUrl: string): string {
    process.env.DATABASE_URL = databaseUrl;
    new PrismaService();
    return adapterUrls[0];
  }

  it('anchors a relative file: URL to backend/prisma, not process.cwd()', () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(path.parse(process.cwd()).root);

    expect(adapterUrlFor('file:./dev.db')).toBe(`file:${path.join(PRISMA_DIR, 'dev.db')}`);

    cwd.mockRestore();
  });

  it('passes an absolute file: URL through unchanged', () => {
    const absolute = `file:${path.resolve('/tmp/some.db')}`;

    expect(adapterUrlFor(absolute)).toBe(absolute);
  });

  it('passes an in-memory URL through unchanged', () => {
    expect(adapterUrlFor('file::memory:')).toBe('file::memory:');
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;

    expect(() => new PrismaService()).toThrow('DATABASE_URL is required');
  });

  it('disconnects on module destroy', async () => {
    process.env.DATABASE_URL = 'file:./dev.db';

    await new PrismaService().onModuleDestroy();

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
