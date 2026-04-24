import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { OCPPServer } from "../../server.js";
import { OCPP_SERVER_INSTANCE } from "./constants.js";

@Injectable()
export class OcppService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(OCPP_SERVER_INSTANCE) private readonly server: OCPPServer,
    @Optional()
    @Inject(HttpAdapterHost)
    private readonly httpAdapterHost?: HttpAdapterHost,
  ) {}

  onModuleInit() {
    // If HttpAdapterHost is available, we attach to the existing NestJS HTTP Server
    // This allows coexistence with regular Express/Fastify routes and Socket.io
    const httpServer = this.httpAdapterHost?.httpAdapter?.getHttpServer();

    if (httpServer) {
      httpServer.on("upgrade", this.handleUpgrade.bind(this));
    }
  }

  onModuleDestroy() {
    const httpServer = this.httpAdapterHost?.httpAdapter?.getHttpServer();
    if (httpServer) {
      httpServer.removeListener("upgrade", this.handleUpgrade.bind(this));
    }

    // Close the OCPP Server gracefully
    this.server.close();
  }

  private handleUpgrade(req: any, socket: any, head: any) {
    // If we want strict coexistence, we should only call server.handleUpgrade
    // if the pathname belongs to OCPP. For now, since OCPPServer handles its own routing,
    // we'll pass all upgrades. If you run into conflicts with Socket.io, you can
    // add a simple pathname prefix check here (e.g., pathname.startsWith('/ocpp')).

    // Check if the URL has an 'upgrade' header to 'websocket'
    if (req.headers.upgrade?.toLowerCase() === "websocket") {
      // Here we could add a check `if (isOcppRoute(pathname))`
      // For maximum compatibility, we let OCPPServer handle it.
      // OCPPServer will ignore it if it doesn't match its internal radix trie,
      // but if it rejects with 404, we might need to intercept.
      // For now, we delegate to the internal handler.
      this.server.handleUpgrade(req, socket, head);
    }
  }
}
