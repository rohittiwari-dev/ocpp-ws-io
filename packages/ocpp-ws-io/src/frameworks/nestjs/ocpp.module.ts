import {
  type DynamicModule,
  Global,
  Module,
  type Provider,
} from "@nestjs/common";
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
} from "@nestjs/core";
import { OCPPServer } from "../../server.js";
import { OCPP_SERVER_INSTANCE } from "./constants.js";
import type {
  OcppModuleAsyncOptions,
  OcppModuleOptions,
} from "./interfaces.js";
import { OcppExplorer } from "./ocpp.explorer.js";
import { OcppService } from "./ocpp.service.js";

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    OcppService,
    {
      provide: OcppExplorer,
      inject: [DiscoveryService, MetadataScanner, OCPP_SERVER_INSTANCE],
      useFactory: (
        discoveryService: DiscoveryService,
        metadataScanner: MetadataScanner,
        server: OCPPServer,
      ) => new OcppExplorer(discoveryService, metadataScanner, server),
    },
  ],
  exports: [OcppService, OCPP_SERVER_INSTANCE],
})
export class OcppModule {
  // Dummy property to avoid static-only class warning
  public readonly _isModule = true;
  static forRoot(options: OcppModuleOptions = {}): DynamicModule {
    const serverProvider: Provider = {
      provide: OCPP_SERVER_INSTANCE,
      useValue: new OCPPServer(options),
    };

    return {
      module: OcppModule,
      providers: [serverProvider],
      exports: [serverProvider],
    };
  }

  static forRootAsync(options: OcppModuleAsyncOptions): DynamicModule {
    const serverProvider: Provider = {
      provide: OCPP_SERVER_INSTANCE,
      useFactory: async (...args: any[]) => {
        const config = options.useFactory
          ? await options.useFactory(...args)
          : {};
        return new OCPPServer(config);
      },
      inject: options.inject || [],
    };

    const providers: Provider[] = [serverProvider];

    if (options.useClass) {
      providers.push({
        provide: options.useClass,
        useClass: options.useClass,
      });
    }

    return {
      module: OcppModule,
      imports: options.imports || [],
      providers,
      exports: [serverProvider],
    };
  }
}
