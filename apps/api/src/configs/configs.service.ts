/**
 * Create/list/get configs with content-addressed deduplication.
 *
 * Flow for POST:
 * 1. Hash the input (canonical JSON → SHA-256)
 * 2. If that hash exists, return the existing row (`created: false`)
 * 3. Else insert a new UUID row, bumping `version` per `name`
 * 4. On a rare race (two inserts same hash), catch Postgres unique violation 23505
 *    and return the winner
 *
 * Experiments store `configId` + `contentHash` so you always know exactly which
 * settings a trial used, even if someone later creates a "same name" config.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { Config, ConfigInput } from '@agent-evals/domain';
import { Repository } from 'typeorm';
import { contentHash } from '../common/canonical-json.js';
import { ConfigEntity } from '../entities/config.entity.js';

/** Postgres error code for unique_violation (contentHash UNIQUE constraint). */
const UNIQUE_VIOLATION = '23505';

export interface ConfigCreateResult {
  config: ConfigEntity;
  created: boolean;
}

@Injectable()
export class ConfigsService {
  constructor(@InjectRepository(ConfigEntity) private readonly repo: Repository<ConfigEntity>) {}

  /**
   * Creates a config, or returns the existing one with the same content hash.
   * The hash covers only the experiment-relevant fields (name, harness, model), so
   * identical content always resolves to the same row, and any change to a setting
   * such as temperature produces a new hash and a new version.
   */
  async create(input: ConfigInput): Promise<ConfigCreateResult> {
    const hash = contentHash(input);

    const existing = await this.repo.findOne({ where: { contentHash: hash } });
    if (existing) {
      return { config: existing, created: false };
    }

    try {
      return await this.repo.manager.transaction(async (manager) => {
        const latest = await manager
          .createQueryBuilder(ConfigEntity, 'c')
          .select('MAX(c.version)', 'max')
          .where('c.name = :name', { name: input.name })
          .getRawOne<{ max: number | null }>();

        const id = randomUUID();
        const version = (latest?.max ?? 0) + 1;
        const createdAt = new Date();
        const document: Config = {
          id,
          name: input.name,
          version,
          harness: input.harness,
          model: input.model,
          contentHash: hash,
          createdAt: createdAt.toISOString(),
        };

        const config = manager.create(ConfigEntity, {
          id,
          name: input.name,
          version,
          contentHash: hash,
          document,
          createdAt,
        });
        await manager.save(config);
        return { config, created: true };
      });
    } catch (err) {
      // A concurrent request inserted the same content between our check and insert.
      if (isUniqueViolation(err)) {
        const winner = await this.repo.findOne({ where: { contentHash: hash } });
        if (winner) {
          return { config: winner, created: false };
        }
      }
      throw err;
    }
  }

  async findAll(): Promise<ConfigEntity[]> {
    return this.repo.find({ order: { name: 'ASC', version: 'ASC' } });
  }

  async findOne(id: string): Promise<ConfigEntity> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`config ${id} not found`);
    }
    return row;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}
