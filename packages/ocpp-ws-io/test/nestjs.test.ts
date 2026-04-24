import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable, Module } from '@nestjs/common';
import 'reflect-metadata';
import {
  OcppModule,
  OcppGateway,
  OcppMessageEvent,
  Params,
  Identity,
  Session,
  OcppAuth,
  Context,
} from '../src/frameworks/nestjs/index.js';
import { OCPPServerClient } from '../src/index.js';
import type { AuthContext } from '../src/index.js';

@OcppGateway('/api/v1/chargers/*')
@Injectable()
class TestGateway {
  @OcppAuth()
  async auth(@Context() ctx: AuthContext) {
    // @ts-ignore - unused variable demonstration
    const _client: OCPPServerClient | null = null;
    if (ctx.handshake.headers['authorization'] === 'Bearer test') {
      ctx.accept({ protocol: 'ocpp1.6', session: { role: 'admin' } });
    } else {
      ctx.reject(401, 'Unauthorized');
    }
  }

  @OcppMessageEvent('BootNotification')
  async handleBoot(@Identity() identity: string, @Params() params: any, @Session() session: any) {
    // @ts-ignore - using variables to suppress IDE warnings
    console.log(identity, params, session);
    return {
      status: 'Accepted',
      currentTime: new Date().toISOString(),
      interval: 300,
      testIdentity: identity,
      testSession: session,
    };
  }
}

@Module({
  imports: [
    OcppModule.forRoot({
      protocols: ['ocpp1.6'],
    }),
  ],
  providers: [TestGateway],
})
class TestModule {}

describe('NestJS OCPP Integration', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();

    await module.init();
  });

  afterAll(async () => {
    await module.close();
  });

  it('should initialize OcppModule properly', () => {
    expect(module).toBeDefined();
    const gateway = module.get(TestGateway);
    expect(gateway).toBeDefined();
  });
});
