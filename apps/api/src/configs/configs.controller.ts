import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigInputSchema, type ConfigInput } from '@agent-evals/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConfigsService } from './configs.service.js';

@Controller('configs')
export class ConfigsController {
  constructor(private readonly configs: ConfigsService) {}

  /** 201 when a new config version was created, 200 when identical content already exists. */
  @Post()
  async create(
    @Body(new ZodValidationPipe(ConfigInputSchema)) body: ConfigInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { config, created } = await this.configs.create(body);
    res.status(created ? 201 : 200);
    return config.document;
  }

  @Get()
  async list() {
    const rows = await this.configs.findAll();
    return rows.map((row) => row.document);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.configs.findOne(id);
    return row.document;
  }
}
