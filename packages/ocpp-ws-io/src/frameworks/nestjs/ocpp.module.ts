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
import { OCPP_SERVER_INSTANCE, OCPP_SERVER_OPTIONS } from "./constants.js";
import type {
  OcppModuleAsyncOptions,
  OcppModuleOptions,
  OcppOptionsFactory,
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
      inject: [
        DiscoveryService,
        MetadataScanner,
        OCPP_SERVER_INSTANCE,
        OcppService,
      ],
      useFactory: (
        discoveryService: DiscoveryService,
        metadataScanner: MetadataScanner,
        server: OCPPServer,
        service: OcppService,
      ) => new OcppExplorer(discoveryService, metadataScanner, server, service),
    },
  ],
  exports: [OcppService, OCPP_SERVER_INSTANCE],
})
export class OcppModule {
  // Dummy property to avoid static-only class warning
  public readonly _isModule = true;
  static forRoot(options: OcppModuleOptions = {}): DynamicModule {
    const optionsProvider: Provider = {
      provide: OCPP_SERVER_OPTIONS,
      useValue: options,
    };
    const serverProvider: Provider = {
      provide: OCPP_SERVER_INSTANCE,
      useValue: new OCPPServer(options),
    };

    return {
      module: OcppModule,
      providers: [optionsProvider, serverProvider],
      exports: [OcppService, OCPP_SERVER_INSTANCE],
    };
  }

  static forRootAsync(options: OcppModuleAsyncOptions): DynamicModule {
    const asyncOptionsProvider = OcppModule.createAsyncOptionsProvider(options);
    const serverProvider: Provider = {
      provide: OCPP_SERVER_INSTANCE,
      useFactory: async (config: OcppModuleOptions) => {
        return new OCPPServer(config);
      },
      inject: [OCPP_SERVER_OPTIONS],
    };

    const providers: Provider[] = [asyncOptionsProvider, serverProvider];

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
      exports: [OcppService, OCPP_SERVER_INSTANCE],
    };
  }

  private static createAsyncOptionsProvider(
    options: OcppModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: OCPP_SERVER_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    const inject = options.useExisting || options.useClass;
    if (inject) {
      return {
        provide: OCPP_SERVER_OPTIONS,
        useFactory: async (factory: OcppOptionsFactory) =>
          factory.createOcppOptions(),
        inject: [inject],
      };
    }

    return {
      provide: OCPP_SERVER_OPTIONS,
      useValue: {},
    };
  }
}
